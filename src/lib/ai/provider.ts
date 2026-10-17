import {
  type AiProvider,
  type AnalyzeImageInput,
  type AnalyzeImageResult,
  type ChatMessage,
  type GenerateResult,
  type GenerateStructuredInput,
  type GenerateStructuredResult,
  type GenerateTextInput,
  type ModelInfo,
  type ProviderCapabilities,
  type StreamEvent,
  type Usage,
  hasImageContent,
  messageToText,
} from '@/lib/ai/types';
import { AiError, capabilityUnsupported, isRetryableAiError } from '@/lib/ai/errors';
import { getEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { recordModelCall } from '@/lib/repositories/logs.repository';

/**
 * Provider 抽象基类 —— 把所有「与供应商无关」的关切集中在这里：
 *
 *   1. 能力校验（不支持就抛明确错误，绝不假装成功）
 *   2. 输入长度限制
 *   3. 超时控制 + 有限次重试（指数退避）
 *   4. 客户端断开处理
 *   5. 结构化输出的运行时 Zod 校验 + 一次修复重试
 *   6. 调用日志（耗时 / 模型 / 状态 / 费用，且不含敏感内容）
 *
 * 子类只需要实现「怎么跟某一家说话」：
 *   rawGenerateText / rawGenerateJson / rawAnalyzeImage / rawStreamText
 */

export type RawTextResult = {
  text: string;
  /** 上游实际返回的模型名（可能与我们请求的不同，如实记录） */
  model: string;
  usage?: Usage;
  finishReason?: string;
};

export type RawStreamChunk =
  | { kind: 'text'; text: string }
  /**
   * 推理模型的「思考过程」分块（如 DeepSeek 的 `reasoning_content`）。
   *
   * 为什么要单独一个 kind 而不是混进 text：
   *   1. 学生界面**不应该**把模型的思考草稿当成答案展示；
   *   2. 但它会真实消耗输出预算 —— 必须能被统计到，
   *      否则会出现「用量对得上、正文却空着」这种难以排查的情况。
   */
  | { kind: 'reasoning'; text: string }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'finish'; finishReason?: string };

/** 把 Base64 图片组装成 data URL，供上游 API 使用。 */
export function toDataUrl(image: { mimeType: string; dataBase64: string }): string {
  return `data:${image.mimeType};base64,${image.dataBase64}`;
}

/**
 * 从模型输出中提取 JSON。
 * 模型常把 JSON 包在 ```json 代码块里，或在前后加一句解释，这里做容错。
 */
export function extractJsonPayload(text: string): { payload: unknown; ok: boolean } {
  const trimmed = text.trim();

  const candidates: string[] = [trimmed];

  // 去掉 ```json ... ``` 或 ``` ... ``` 包裹
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  // 退而求其次：取第一个 { 到最后一个 } 之间的内容
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return { payload: JSON.parse(candidate), ok: true };
    } catch {
      // 尝试下一个候选
    }
  }

  return { payload: null, ok: false };
}

/** 校验一次调用的输入长度，超出直接报错（而不是让上游返回 400）。 */
function assertInputWithinLimit(messages: ChatMessage[], maxChars: number): number {
  const total = messages.reduce((sum, m) => sum + messageToText(m).length, 0);
  if (total > maxChars) {
    throw new AiError('AI_INPUT_TOO_LONG', {
      message: `输入长度 ${total} 超出上限 ${maxChars}`,
      userMessage: `这次的内容太长了（约 ${total} 字，上限 ${maxChars} 字）。可以把问题拆成几段分开问，或者只上传题目中最关键的部分。`,
      details: { totalChars: total, maxChars },
    });
  }
  return total;
}

/** 合并外部信号与超时信号。 */
function combineSignals(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
    timedOut: () => timedOut,
  };
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export abstract class AbstractAiProvider implements AiProvider {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly defaultModel: string;
  readonly visionModel?: string;

  protected abstract declareCapabilities(): ProviderCapabilities;

  // ---- 子类必须实现 ----
  protected abstract rawGenerateText(
    input: GenerateTextInput,
    ctx: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ): Promise<RawTextResult>;

  protected abstract rawAnalyzeImage(
    input: AnalyzeImageInput,
    ctx: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ): Promise<RawTextResult>;

  /** 默认实现：退化为普通文本生成（适用于没有原生 json 模式的供应商） */
  protected async rawGenerateJson(
    input: GenerateStructuredInput<unknown>,
    ctx: { model: string; signal: AbortSignal; maxOutputTokens: number; repairHint?: string },
  ): Promise<RawTextResult> {
    const messages = input.repairHint
      ? [...input.messages, { role: 'user' as const, content: input.repairHint }]
      : input.messages;
    return this.rawGenerateText({ ...input, messages }, ctx);
  }

  /** 默认实现：不支持流式时返回 null，由基类回退为非流式。 */
  protected rawStreamText(
    _input: GenerateTextInput,
    _ctx: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ): AsyncIterable<RawStreamChunk> | null {
    return null;
  }

  getCapabilities(): ProviderCapabilities {
    return this.declareCapabilities();
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    // 默认只声明配置里指定的模型 —— 不去"猜"供应商有哪些模型，
    // 也不编造模型名。支持模型列表查询的子类会覆盖这个实现。
    const models: ModelInfo[] = [];
    if (this.defaultModel) {
      models.push({ id: this.defaultModel, label: this.defaultModel, vision: false });
    }
    if (this.visionModel && this.visionModel !== this.defaultModel) {
      models.push({ id: this.visionModel, label: this.visionModel, vision: true });
    }
    return models;
  }

  // ---------------------------------------------------------------------------
  // 文本生成
  // ---------------------------------------------------------------------------

  async generateText(input: GenerateTextInput): Promise<GenerateResult> {
    const caps = this.getCapabilities();
    if (!caps.text) {
      throw capabilityUnsupported('文本生成', this.id);
    }

    const promptChars = assertInputWithinLimit(input.messages, caps.maxInputChars);
    const started = Date.now();
    const { AI_MAX_RETRIES: maxRetries, AI_TIMEOUT_MS, AI_MAX_OUTPUT_TOKENS } = getEnv();

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      const timeoutMs = input.timeoutMs ?? AI_TIMEOUT_MS;
      const { signal, cleanup, timedOut } = combineSignals(timeoutMs, input.signal);

      try {
        const raw = await this.rawGenerateText(input, {
          model: this.defaultModel,
          signal,
          maxOutputTokens: input.maxOutputTokens ?? AI_MAX_OUTPUT_TOKENS,
        });

        const latencyMs = Date.now() - started;
        cleanup();

        await recordModelCall({
          service: input.service,
          provider: this.id,
          model: raw.model,
          status: 'success',
          latencyMs,
          promptChars,
          completionChars: raw.text.length,
          promptTokens: raw.usage?.promptTokens,
          completionTokens: raw.usage?.completionTokens,
          estimatedCostUsd: raw.usage?.costUsd,
          retryCount: attempt,
        });

        return {
          text: raw.text,
          model: raw.model,
          providerId: this.id,
          usage: raw.usage,
          finishReason: raw.finishReason,
          latencyMs,
          retryCount: attempt,
        };
      } catch (error) {
        cleanup();
        lastError = error;
        const normalized = this.normalizeError(error, timedOut(), input.signal?.aborted === true);

        if (!isRetryableAiError(normalized) || attempt === maxRetries) {
          await recordModelCall({
            service: input.service,
            provider: this.id,
            model: this.defaultModel,
            status: normalized.aiCode === 'AI_TIMEOUT' ? 'timeout' : 'error',
            latencyMs: Date.now() - started,
            promptChars,
            retryCount: attempt,
            errorCode: normalized.aiCode,
            errorMessage: normalized.message,
          });
          throw normalized;
        }

        // 指数退避：300ms, 600ms, 1200ms…
        const backoff = 300 * 2 ** attempt;
        logger.warn('ai.retry', { provider: this.id, service: input.service, attempt: attempt + 1, backoff });
        await sleep(backoff, input.signal);
        attempt += 1;
      }
    }

    throw lastError instanceof Error ? lastError : new AiError('AI_UPSTREAM_ERROR');
  }

  // ---------------------------------------------------------------------------
  // 结构化输出
  // ---------------------------------------------------------------------------

  /**
   * 结构化生成：**永不信任模型返回的 JSON**。
   * 流程：调用 → 提取 JSON → Zod 校验 → 失败则带修复提示重试一次 → 再失败就报错。
   */
  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<GenerateStructuredResult<T>> {
    const caps = this.getCapabilities();
    if (!caps.structured && caps.structuredFallback === 'none') {
      throw capabilityUnsupported('结构化输出', this.id);
    }

    const schemaHint = this.buildSchemaInstruction(input.schemaName, input.schemaDescription, input.jsonSchema);
    const messages: ChatMessage[] = [...input.messages, { role: 'user', content: schemaHint }];

    const promptChars = assertInputWithinLimit(messages, caps.maxInputChars);
    const started = Date.now();
    const { AI_MAX_RETRIES: maxRetries, AI_TIMEOUT_MS, AI_MAX_OUTPUT_TOKENS } = getEnv();

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      const timeoutMs = input.timeoutMs ?? AI_TIMEOUT_MS;
      const { signal, cleanup, timedOut } = combineSignals(timeoutMs, input.signal);

      try {
        const raw = await this.rawGenerateJson(
          { ...input, messages },
          {
            model: this.defaultModel,
            signal,
            maxOutputTokens: input.maxOutputTokens ?? AI_MAX_OUTPUT_TOKENS,
          },
        );
        cleanup();

        const extracted = extractJsonPayload(raw.text);
        if (!extracted.ok) {
          throw new AiError('AI_INVALID_OUTPUT', {
            message: '模型输出中找不到合法 JSON',
            userMessage: 'AI 返回的内容格式不对，正在重试…',
          });
        }

        const parsed = input.schema.safeParse(extracted.payload);
        if (!parsed.success) {
          throw new AiError('AI_INVALID_OUTPUT', {
            message: `结构化输出校验失败：${parsed.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')}`,
            details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          });
        }

        const latencyMs = Date.now() - started;
        await recordModelCall({
          service: input.service,
          provider: this.id,
          model: raw.model,
          status: 'success',
          latencyMs,
          promptChars,
          completionChars: raw.text.length,
          promptTokens: raw.usage?.promptTokens,
          completionTokens: raw.usage?.completionTokens,
          estimatedCostUsd: raw.usage?.costUsd,
          schemaValidated: true,
          retryCount: attempt,
        });

        return {
          text: raw.text,
          value: parsed.data,
          model: raw.model,
          providerId: this.id,
          usage: raw.usage,
          finishReason: raw.finishReason,
          latencyMs,
          retryCount: attempt,
          schemaValidated: true,
          repaired: attempt > 0,
        };
      } catch (error) {
        cleanup();
        lastError = error;
        const normalized = this.normalizeError(error, timedOut(), input.signal?.aborted === true);

        if (attempt === maxRetries || (!isRetryableAiError(normalized) && normalized.aiCode !== 'AI_INVALID_OUTPUT')) {
          await recordModelCall({
            service: input.service,
            provider: this.id,
            model: this.defaultModel,
            status: normalized.aiCode === 'AI_TIMEOUT' ? 'timeout' : 'error',
            latencyMs: Date.now() - started,
            promptChars,
            retryCount: attempt,
            errorCode: normalized.aiCode,
            errorMessage: normalized.message,
          });
          throw normalized;
        }

        logger.warn('ai.structured_retry', {
          provider: this.id,
          service: input.service,
          attempt: attempt + 1,
          reason: normalized.aiCode,
        });
        await sleep(300 * 2 ** attempt, input.signal);
        attempt += 1;
      }
    }

    throw lastError instanceof Error ? lastError : new AiError('AI_INVALID_OUTPUT');
  }

  /** 把 JSON Schema 转成给模型的自然语言约束说明。 */
  protected buildSchemaInstruction(
    schemaName: string,
    description?: string,
    jsonSchema?: Record<string, unknown>,
  ): string {
    const lines = [
      '请只输出一个 JSON 对象，不要输出任何解释文字，不要使用 Markdown 代码块。',
      `这个 JSON 必须符合「${schemaName}」的结构${description ? `：${description}` : '。'}`,
    ];
    if (jsonSchema) {
      lines.push('JSON Schema 如下：');
      lines.push(JSON.stringify(jsonSchema));
    }
    lines.push('如果某个字段你不确定，请使用空数组、空字符串或较低的置信度，不要编造内容。');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // 图片理解
  // ---------------------------------------------------------------------------

  async analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageResult> {
    const caps = this.getCapabilities();
    if (!caps.vision || !this.visionModel) {
      throw capabilityUnsupported(
        '图片理解',
        this.id,
        '当前配置的模型不支持图片识别。你可以手动录入题目内容，或在 .env 中设置支持视觉的 AI_VISION_MODEL。',
      );
    }

    const started = Date.now();
    const { AI_TIMEOUT_MS, AI_MAX_OUTPUT_TOKENS } = getEnv();
    const timeoutMs = input.timeoutMs ?? AI_TIMEOUT_MS;
    const { signal, cleanup, timedOut } = combineSignals(timeoutMs, input.signal);

    try {
      const raw = await this.rawAnalyzeImage(input, {
        model: this.visionModel,
        signal,
        maxOutputTokens: input.maxOutputTokens ?? AI_MAX_OUTPUT_TOKENS,
      });

      const latencyMs = Date.now() - started;
      cleanup();

      await recordModelCall({
        service: input.service,
        provider: this.id,
        model: raw.model,
        status: 'success',
        latencyMs,
        // 只记录文本长度，图片本身与提示词都不落库
        promptChars: input.instruction.length,
        completionChars: raw.text.length,
        promptTokens: raw.usage?.promptTokens,
        completionTokens: raw.usage?.completionTokens,
        estimatedCostUsd: raw.usage?.costUsd,
      });

      return {
        text: raw.text,
        model: raw.model,
        providerId: this.id,
        usage: raw.usage,
        latencyMs,
      };
    } catch (error) {
      cleanup();
      const normalized = this.normalizeError(error, timedOut(), input.signal?.aborted === true);
      await recordModelCall({
        service: input.service,
        provider: this.id,
        model: this.visionModel,
        status: normalized.aiCode === 'AI_TIMEOUT' ? 'timeout' : 'error',
        latencyMs: Date.now() - started,
        errorCode: normalized.aiCode,
        errorMessage: normalized.message,
      });
      throw normalized;
    }
  }

  // ---------------------------------------------------------------------------
  // 流式
  // ---------------------------------------------------------------------------

  /** 不支持流式的 provider 会走这个回退：一次性生成后切成小块吐出，保证上游接口一致。 */
  async *streamText(input: GenerateTextInput): AsyncIterable<StreamEvent> {
    const caps = this.getCapabilities();
    if (!caps.text) throw capabilityUnsupported('文本生成', this.id);

    const promptChars = assertInputWithinLimit(input.messages, caps.maxInputChars);
    const started = Date.now();
    const timeoutMs = input.timeoutMs ?? getEnv().AI_TIMEOUT_MS;
    const { AI_MAX_RETRIES: maxRetries, AI_MAX_OUTPUT_TOKENS } = getEnv();

    let attempt = 0;

    while (attempt <= maxRetries) {
      const { signal, cleanup, timedOut } = combineSignals(timeoutMs, input.signal);
      const model = this.defaultModel;

      yield { type: 'start', model, providerId: this.id };

      try {
        if (caps.streaming) {
          const stream = this.rawStreamText(input, {
            model,
            signal,
            maxOutputTokens: input.maxOutputTokens ?? AI_MAX_OUTPUT_TOKENS,
          });

          if (stream) {
            let completionChars = 0;
            let reasoningChars = 0;
            let usage: Usage | undefined;
            let finishReason: string | undefined;

            for await (const chunk of stream) {
              if (chunk.kind === 'text') {
                completionChars += chunk.text.length;
                yield { type: 'delta', text: chunk.text };
              } else if (chunk.kind === 'reasoning') {
                // 思考过程不展示给学生，但必须计数（它占用了输出预算）
                reasoningChars += chunk.text.length;
              } else if (chunk.kind === 'usage') {
                usage = chunk.usage;
              } else {
                finishReason = chunk.finishReason;
              }
            }

            cleanup();

            /**
             * 关键防护：推理模型把输出预算全部花在思考上时，正文会是空的。
             * 这种情况下**必须明确报错**，而不是返回一条空回复 ——
             * 空回复对学生来说比报错更糟（他以为这就是全部答案）。
             */
            if (completionChars === 0 && reasoningChars > 0 && finishReason === 'length') {
              yield {
                type: 'error',
                code: 'AI_INPUT_TOO_LONG',
                message:
                  '模型在思考阶段用尽了输出长度，没能写出正式回答。请在 .env 中调大 AI_MAX_OUTPUT_TOKENS（例如 8192），或把问题拆得更短一些。',
              };
              return;
            }

            const latencyMs = Date.now() - started;
            if (usage) yield { type: 'usage', usage };

            await recordModelCall({
              service: input.service,
              provider: this.id,
              model,
              status: 'success',
              latencyMs,
              promptChars,
              completionChars,
              promptTokens: usage?.promptTokens,
              completionTokens: usage?.completionTokens,
              estimatedCostUsd: usage?.costUsd,
              retryCount: attempt,
            });

            yield { type: 'done', latencyMs, finishReason, retryCount: attempt };
            return;
          }
        }

        // 回退：非流式生成 → 分块吐出
        const raw = await this.rawGenerateText(input, {
          model,
          signal,
          maxOutputTokens: input.maxOutputTokens ?? AI_MAX_OUTPUT_TOKENS,
        });
        cleanup();

        for (const piece of chunkText(raw.text, 24)) {
          yield { type: 'delta', text: piece };
        }

        const latencyMs = Date.now() - started;
        if (raw.usage) yield { type: 'usage', usage: raw.usage };

        await recordModelCall({
          service: input.service,
          provider: this.id,
          model: raw.model,
          status: 'success',
          latencyMs,
          promptChars,
          completionChars: raw.text.length,
          promptTokens: raw.usage?.promptTokens,
          completionTokens: raw.usage?.completionTokens,
          estimatedCostUsd: raw.usage?.costUsd,
          retryCount: attempt,
        });

        yield { type: 'done', latencyMs, finishReason: raw.finishReason, retryCount: attempt };
        return;
      } catch (error) {
        cleanup();
        const normalized = this.normalizeError(error, timedOut(), input.signal?.aborted === true);

        if (!isRetryableAiError(normalized) || attempt === maxRetries) {
          await recordModelCall({
            service: input.service,
            provider: this.id,
            model,
            status: normalized.aiCode === 'AI_TIMEOUT' ? 'timeout' : 'error',
            latencyMs: Date.now() - started,
            promptChars,
            retryCount: attempt,
            errorCode: normalized.aiCode,
            errorMessage: normalized.message,
          });
          yield { type: 'error', code: normalized.aiCode, message: normalized.userMessage };
          return;
        }

        attempt += 1;
        await sleep(300 * 2 ** (attempt - 1), input.signal);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 错误归一化
  // ---------------------------------------------------------------------------

  protected normalizeError(error: unknown, timedOut: boolean, aborted: boolean): AiError {
    if (error instanceof AiError) return error;

    if (timedOut) {
      return new AiError('AI_TIMEOUT', {
        message: `${this.id} 请求超时`,
        userMessage: 'AI 响应超时了。可以稍后再试，或者把问题拆小一点再问。',
        cause: error,
      });
    }

    if (aborted) {
      return new AiError('AI_ABORTED', {
        message: '客户端已断开',
        userMessage: '这次请求已取消。',
        cause: error,
      });
    }

    return new AiError('AI_UPSTREAM_ERROR', {
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }

  /** 判断消息里是否含图片（子类用于选择模型或校验能力） */
  protected containsImage(messages: ChatMessage[]): boolean {
    return messages.some(hasImageContent);
  }
}

/** 把长文本按固定长度切块（流式回退用）。 */
export function chunkText(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
