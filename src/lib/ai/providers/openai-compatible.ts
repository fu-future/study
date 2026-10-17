import type {
  AnalyzeImageInput,
  ChatMessage,
  GenerateStructuredInput,
  GenerateTextInput,
  ModelInfo,
  ProviderCapabilities,
} from '@/lib/ai/types';
import { AbstractAiProvider, toDataUrl, type RawStreamChunk, type RawTextResult } from '@/lib/ai/provider';
import { AiError } from '@/lib/ai/errors';
import { getEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * OpenAI 兼容适配器（也用于 DeepSeek 等 provider）。
 *
 * ⚠️ 需求明确提醒：不同供应商的「OpenAI 兼容」程度不一样，
 *    图片理解、结构化输出、流式调用必须**逐项验证**，不可假定全部兼容。
 *    因此本适配器采取的策略是：
 *      1. 能力由配置**显式声明**（AI_VISION_MODEL 有值才启用 vision）；
 *      2. 结构化输出优先用 response_format=json_object，失败时自动降级为纯提示词约束
 *         （基类的 Zod 校验 + 修复重试仍然兜底，因此即使上游不支持也不会产出脏数据）；
 *      3. 错误按状态码细分，不把上游原始错误体回传给浏览器。
 *
 * 当前实现**只在 Mock 路径下被真实运行过**；DeepSeek 路径的代码已按官方文档实现，
 * 但需要你填入 API Key 后才能验证。这一点在 README 与 /settings 页面都有说明。
 */

type OpenAiChatResponse = {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

type OpenAiErrorBody = { error?: { message?: string; type?: string; code?: string } };

export type OpenAiCompatibleOptions = {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel?: string;
  /** 是否尝试使用 response_format: { type: 'json_object' } */
  supportsJsonMode?: boolean;
};

export class OpenAiCompatibleProvider extends AbstractAiProvider {
  readonly id: string;
  readonly label: string;
  readonly defaultModel: string;
  override readonly visionModel?: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly supportsJsonMode: boolean;
  /** 一旦上游拒绝 json_object，就记住并永久降级，避免每次都白试一次 */
  private jsonModeDisabled = false;

  constructor(options: OpenAiCompatibleOptions) {
    super();
    this.id = options.id;
    this.label = options.label;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.defaultModel = options.model;
    this.visionModel = options.visionModel;
    this.supportsJsonMode = options.supportsJsonMode ?? true;
  }

  protected declareCapabilities(): ProviderCapabilities {
    return {
      text: true,
      streaming: true,
      // 结构化输出始终为 true：即使上游不支持 json_object（jsonModeDisabled），
      // 基类仍会用「提示词约束 + Zod 运行时校验 + 一次修复重试」兜底，
      // 只是可靠性较低 —— 用 structuredFallback 如实反映这个差别。
      structured: true,
      structuredFallback: this.supportsJsonMode && !this.jsonModeDisabled ? 'json-mode' : 'prompt-only',
      // 只有显式配置了视觉模型才声称支持图片理解
      vision: Boolean(this.visionModel),
      maxInputChars: 24_000,
    };
  }

  override async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(Math.min(8000, getEnv().AI_TIMEOUT_MS)),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const body = (await response.json()) as { data?: { id?: string }[] };
      const models = (body.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .map<ModelInfo>((id) => ({
          id,
          label: id,
          // 模型是否有视觉能力无法从该接口得知，因此不猜测：
          // 只有与 AI_VISION_MODEL 完全一致的才标记为 vision。
          vision: id === this.visionModel,
        }));

      if (models.length > 0) {
        // 确保配置里的模型一定出现在列表里（有些兼容端点不返回全部模型）
        if (!models.some((m) => m.id === this.defaultModel)) {
          models.unshift({ id: this.defaultModel, label: this.defaultModel, vision: false });
        }
        return models;
      }
    } catch (error) {
      logger.warn('ai.models_list_failed', {
        provider: this.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    // 查不到就如实返回配置里声明的模型，不编造模型清单
    return super.getAvailableModels();
  }

  // ---------------------------------------------------------------------------
  // 消息转换
  // ---------------------------------------------------------------------------

  private toOpenAiMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((message) => {
      if (typeof message.content === 'string') {
        return { role: message.role, content: message.content };
      }

      const parts = message.content.map((part) =>
        part.type === 'text'
          ? { type: 'text', text: part.text }
          : { type: 'image_url', image_url: { url: toDataUrl(part) } },
      );
      return { role: message.role, content: parts };
    });
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw await this.toAiError(response);
    }
    return response;
  }

  /** 把上游错误映射成我们的错误类型；不把上游原始响应体回传浏览器。 */
  private async toAiError(response: Response): Promise<AiError> {
    let upstreamMessage = '';
    let upstreamType = '';
    try {
      const body = (await response.json()) as OpenAiErrorBody;
      upstreamMessage = body.error?.message ?? '';
      upstreamType = body.error?.type ?? body.error?.code ?? '';
    } catch {
      // 上游可能返回非 JSON，忽略
    }

    const status = response.status;

    if (status === 401 || status === 403) {
      return new AiError('AI_NOT_CONFIGURED', {
        message: `上游拒绝鉴权（${status}）：${upstreamMessage || upstreamType}`,
        userMessage: 'AI 密钥无效或已过期，请在 .env 中更新 AI_API_KEY 后重启服务。',
        upstreamStatus: status,
      });
    }

    if (status === 429) {
      return new AiError('AI_RATE_LIMITED', {
        message: `上游限流（429）：${upstreamMessage}`,
        userMessage: 'AI 服务当前请求过多，等一会儿再试。',
        upstreamStatus: status,
      });
    }

    // 上下文过长：明确提示拆题，而不是笼统报错
    if (
      status === 400 &&
      /context|length|token|too long|maximum/i.test(`${upstreamMessage} ${upstreamType}`)
    ) {
      return new AiError('AI_INPUT_TOO_LONG', {
        message: `上游拒绝：输入过长（${upstreamMessage}）`,
        userMessage: '这次内容超出了模型的处理长度，把问题拆成几部分再问效果会更好。',
        upstreamStatus: status,
      });
    }

    return new AiError('AI_UPSTREAM_ERROR', {
      message: `上游返回 ${status}：${upstreamMessage || upstreamType || '(无错误信息)'}`,
      upstreamStatus: status,
    });
  }

  private usageFrom(body: OpenAiChatResponse): { promptTokens?: number; completionTokens?: number } {
    // 只在供应商真的返回用量时才透传；不估算、不填充假数据
    return {
      promptTokens: body.usage?.prompt_tokens,
      completionTokens: body.usage?.completion_tokens,
    };
  }

  // ---------------------------------------------------------------------------
  // 文本
  // ---------------------------------------------------------------------------

  protected async rawGenerateText(
    input: GenerateTextInput,
    ctx: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ): Promise<RawTextResult> {
    const response = await this.post(
      '/chat/completions',
      {
        model: ctx.model,
        messages: this.toOpenAiMessages(input.messages),
        temperature: input.temperature ?? 0.3,
        max_tokens: ctx.maxOutputTokens,
        stream: false,
      },
      ctx.signal,
    );

    const body = (await response.json()) as OpenAiChatResponse;
    const text = body.choices?.[0]?.message?.content ?? '';

    if (!text) {
      throw new AiError('AI_UPSTREAM_ERROR', {
        message: '上游返回了空内容',
        userMessage: 'AI 这次没有返回内容，请重试一次。',
      });
    }

    return {
      text,
      model: body.model ?? ctx.model,
      usage: this.usageFrom(body),
      finishReason: body.choices?.[0]?.finish_reason,
    };
  }

  // ---------------------------------------------------------------------------
  // 结构化输出：优先 json_object，被拒绝则降级为提示词约束
  // ---------------------------------------------------------------------------

  protected override async rawGenerateJson(
    input: GenerateStructuredInput<unknown>,
    ctx: { model: string; signal: AbortSignal; maxOutputTokens: number; repairHint?: string },
  ): Promise<RawTextResult> {
    const messages = input.repairHint
      ? [...input.messages, { role: 'user' as const, content: input.repairHint }]
      : input.messages;

    const useJsonMode = this.supportsJsonMode && !this.jsonModeDisabled;

    const buildBody = (jsonMode: boolean) => ({
      model: ctx.model,
      messages: this.toOpenAiMessages(messages),
      temperature: input.temperature ?? 0.2,
      max_tokens: ctx.maxOutputTokens,
      stream: false,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });

    let response: Response;
    try {
      response = await this.post('/chat/completions', buildBody(useJsonMode), ctx.signal);
    } catch (error) {
      // 上游明确拒绝 json_object 时，永久降级并立刻用纯提示词重试一次
      if (
        useJsonMode &&
        error instanceof AiError &&
        error.upstreamStatus === 400 &&
        error.aiCode !== 'AI_INPUT_TOO_LONG'
      ) {
        logger.warn('ai.json_mode_unsupported', { provider: this.id });
        this.jsonModeDisabled = true;
        response = await this.post('/chat/completions', buildBody(false), ctx.signal);
      } else {
        throw error;
      }
    }

    const body = (await response.json()) as OpenAiChatResponse;
    const text = body.choices?.[0]?.message?.content ?? '';

    return {
      text,
      model: body.model ?? ctx.model,
      usage: this.usageFrom(body),
      finishReason: body.choices?.[0]?.finish_reason,
    };
  }

  // ---------------------------------------------------------------------------
  // 图片理解
  // ---------------------------------------------------------------------------

  protected async rawAnalyzeImage(
    input: AnalyzeImageInput,
    ctx: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ): Promise<RawTextResult> {
    if (!this.visionModel) {
      // 基类已拦过一次，这里是双保险
      throw new AiError('AI_CAPABILITY_UNSUPPORTED', {
        message: `${this.id} 未配置视觉模型`,
      });
    }

    // 只有声明了 visionModel 的模型才走这条路径。
    // 注意：不要把主模型（如 deepseek-chat）当作视觉模型使用 —— 它不支持图片输入。
    const content: unknown[] = [{ type: 'text', text: input.instruction }];
    if (input.context) {
      content.push({ type: 'text', text: `补充上下文：${input.context}` });
    }
    content.push({ type: 'image_url', image_url: { url: toDataUrl(input.image) } });

    const response = await this.post(
      '/chat/completions',
      {
        model: this.visionModel,
        messages: [{ role: 'user', content }],
        temperature: 0.1,
        max_tokens: ctx.maxOutputTokens,
        stream: false,
      },
      ctx.signal,
    );

    const body = (await response.json()) as OpenAiChatResponse;
    const text = body.choices?.[0]?.message?.content ?? '';

    return {
      text,
      model: body.model ?? this.visionModel,
      usage: this.usageFrom(body),
      finishReason: body.choices?.[0]?.finish_reason,
    };
  }

  // ---------------------------------------------------------------------------
  // 流式
  // ---------------------------------------------------------------------------

  protected override rawStreamText(
    input: GenerateTextInput,
    ctx: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ): AsyncIterable<RawStreamChunk> {
    // 直接返回一个 async generator 方法的结果：
    // 方法调用时 `this` 已经正确绑定，因此不需要（也不应该）用 `const self = this` 别名。
    return this.streamChunks(input, ctx);
  }

  private async *streamChunks(
    input: GenerateTextInput,
    ctx: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ): AsyncGenerator<RawStreamChunk> {
    {
        const response = await this.post(
          '/chat/completions',
          {
            model: ctx.model,
            messages: this.toOpenAiMessages(input.messages),
            temperature: input.temperature ?? 0.3,
            max_tokens: ctx.maxOutputTokens,
            stream: true,
            // 显式要求带上用量，便于成本核算；部分兼容端点会忽略它
            stream_options: { include_usage: true },
          },
          ctx.signal,
        );

        if (!response.body) {
          throw new AiError('AI_UPSTREAM_ERROR', { message: '上游流式响应没有 body' });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE 以空行分隔事件
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
              const rawEvent = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              boundary = buffer.indexOf('\n\n');

              for (const line of rawEvent.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();

                if (data === '[DONE]') return;

                try {
                  const parsed = JSON.parse(data) as {
                    choices?: {
                      delta?: { content?: string | null; reasoning_content?: string | null };
                      finish_reason?: string;
                    }[];
                    usage?: { prompt_tokens?: number; completion_tokens?: number };
                  };

                  const delta = parsed.choices?.[0]?.delta;

                  /**
                   * 推理模型（如 deepseek-flash）会先流式返回 `reasoning_content`（思考过程），
                   * 之后才是 `content`（正式回答）。两者必须分开处理：
                   *   - 思考过程不展示给学生（那是草稿，不是答案）
                   *   - 但要单独上报，因为它真实占用输出预算，
                   *     否则会出现「用量满了、正文却是空的」这种诡异现象
                   */
                  if (delta?.reasoning_content) {
                    yield { kind: 'reasoning', text: delta.reasoning_content };
                  }
                  if (delta?.content) {
                    yield { kind: 'text', text: delta.content };
                  }

                  const finish = parsed.choices?.[0]?.finish_reason;
                  if (finish) yield { kind: 'finish', finishReason: finish };

                  if (parsed.usage) {
                    yield {
                      kind: 'usage',
                      usage: {
                        promptTokens: parsed.usage.prompt_tokens,
                        completionTokens: parsed.usage.completion_tokens,
                      },
                    };
                  }
                } catch {
                  // 单条事件解析失败不中断整条流（上游偶尔会插入心跳）
                }
              }
            }
          }
        } finally {
          // 客户端断开时释放连接，避免上游继续计费
          await reader.cancel().catch(() => undefined);
        }
    }
  }
}

/**
 * DeepSeek 预设。
 * base_url / 模型名来自 DeepSeek 官方文档（OpenAI 兼容）。
 * 注意：deepseek-chat 不支持图片输入，因此 visionModel 默认留空，
 * 除非用户在 .env 里显式配置了支持视觉的模型。
 */
export function createDeepSeekProvider(config: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  visionModel?: string;
}): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: config.baseUrl || 'https://api.deepseek.com',
    apiKey: config.apiKey,
    model: config.model || 'deepseek-chat',
    visionModel: config.visionModel,
    // DeepSeek 的 OpenAI 兼容接口支持 response_format: json_object
    supportsJsonMode: true,
  });
}
