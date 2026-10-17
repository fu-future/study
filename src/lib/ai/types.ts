import type { z } from 'zod';

/**
 * 统一 AI Provider 接口的类型定义。
 *
 * 设计目标（对应需求第五节）：
 *   - 业务模块只依赖这些类型，绝不直接依赖某一家模型 SDK。
 *   - 能力（文本 / 结构化 / 流式 / 图片理解）逐项声明，不做「假定全部兼容」。
 *   - 不同供应商的 OpenAI 兼容程度不同，因此能力必须由**适配器自己**如实声明，
 *     不支持时抛 CapabilityUnsupportedError，而不是假装成功。
 */

// -----------------------------------------------------------------------------
// 消息
// -----------------------------------------------------------------------------

export type ChatRole = 'system' | 'user' | 'assistant';

export type TextPart = { type: 'text'; text: string };

export type ImagePart = {
  type: 'image';
  /** 形如 image/png、image/jpeg、image/webp */
  mimeType: string;
  /** 不含 data: 前缀的纯 base64 */
  dataBase64: string;
};

export type ContentPart = TextPart | ImagePart;

export type ChatMessage = {
  role: ChatRole;
  /** 纯文本，或包含图片的多部分内容 */
  content: string | ContentPart[];
};

/** 把消息内容统一规整成文本（用于长度计算、日志、提示词拼接）。 */
export function messageToText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map((part) => (part.type === 'text' ? part.text : `[图片 ${part.mimeType}]`))
    .join('\n');
}

/** 消息里是否包含图片 */
export function hasImageContent(message: ChatMessage): boolean {
  if (typeof message.content === 'string') return false;
  return message.content.some((part) => part.type === 'image');
}

// -----------------------------------------------------------------------------
// 能力声明
// -----------------------------------------------------------------------------

export type ProviderCapabilities = {
  text: boolean;
  streaming: boolean;
  /** 是否支持 response_format: json_schema / json_object 或等效的结构化输出约束 */
  structured: boolean;
  /** 是否支持图片输入 */
  vision: boolean;
  /** 单次请求允许的最大输入字符数（适配器自己声明的保守上限） */
  maxInputChars: number;
  /** 不支持结构化输出时的补救方式说明，供界面提示使用 */
  structuredFallback?: 'json-mode' | 'prompt-only' | 'none';
};

export type ModelInfo = {
  id: string;
  label: string;
  /** 该模型是否支持图片输入 */
  vision: boolean;
  contextChars?: number;
};

// -----------------------------------------------------------------------------
// 入参 / 出参
// -----------------------------------------------------------------------------

export type Usage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** 上游返回的费用（美元）；拿不到就留空，不估算假数据 */
  costUsd?: number;
};

export type GenerateTextInput = {
  messages: ChatMessage[];
  /** 该次调用属于哪个业务服务，用于日志归类 */
  service: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** 上游超时（毫秒）；不传则用 AI_TIMEOUT_MS */
  timeoutMs?: number;
  /** 外部取消信号（如客户端断开） */
  signal?: AbortSignal;
};

export type GenerateStructuredInput<T> = GenerateTextInput & {
  /**
   * 运行时校验用的 Zod Schema。
   *
   * 第三个类型参数（Input）显式写成 `unknown`：因为 Schema 里大量使用 `.default()`，
   * 其「输入类型」的字段是可选的，而「输出类型」是必填的。
   * 若这里让 Input 默认等于 T（= 输出类型），这些 Schema 会因为
   * 可空性不一致而无法赋值。写成 unknown 表示「任何形状的输入都能接受，
   * 输出由 T 保证」—— 这正是我们想要的契约。
   */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** 传给模型的结构说明名（不影响本地校验） */
  schemaName: string;
  schemaDescription?: string;
  /** 传给上游的 JSON Schema；不传则由框架生成提示词约束 */
  jsonSchema?: Record<string, unknown>;
  /**
   * 上一次输出不合规时，附加在对话末尾的修复提示。
   * 由 AbstractAiProvider 在重试时填入，适配器负责把它拼进消息里。
   */
  repairHint?: string;
};

export type GenerateResult = {
  text: string;
  model: string;
  providerId: string;
  usage?: Usage;
  finishReason?: string;
  latencyMs: number;
  /** 是否经过重试 */
  retryCount: number;
};

export type GenerateStructuredResult<T> = GenerateResult & {
  value: T;
  /** JSON 是否通过了运行时 Zod 校验（永不信任模型返回的 JSON） */
  schemaValidated: boolean;
  /** 校验失败后是否通过修复提示词重试成功 */
  repaired: boolean;
};

export type AnalyzeImageInput = {
  /** 图片的 base64（不含 data: 前缀）与 mime */
  image: ImagePart;
  /** 需要从图片中提取什么，用自然语言描述 */
  instruction: string;
  /** 额外的学科/年级上下文 */
  context?: string;
  service: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputTokens?: number;
};

export type AnalyzeImageResult = {
  /** 模型对图片的自由文本描述/识别结果 */
  text: string;
  model: string;
  providerId: string;
  usage?: Usage;
  latencyMs: number;
};

// -----------------------------------------------------------------------------
// 流式事件
// -----------------------------------------------------------------------------

export type StreamEvent =
  | { type: 'start'; model: string; providerId: string }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; latencyMs: number; finishReason?: string; retryCount: number }
  | { type: 'error'; code: string; message: string };

// -----------------------------------------------------------------------------
// Provider 接口
// -----------------------------------------------------------------------------

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  readonly defaultModel: string;
  /** 视觉模型（可能为空，表示该 provider 没有配置图片理解能力） */
  readonly visionModel?: string;

  /** 能力声明：必须如实反映该 provider/模型组合的真实能力 */
  getCapabilities(): ProviderCapabilities;

  /** 可用模型列表。mock 返回内置列表；真实 provider 若无法查询则返回配置里声明的模型。 */
  getAvailableModels(): Promise<ModelInfo[]>;

  generateText(input: GenerateTextInput): Promise<GenerateResult>;

  generateStructured<T>(input: GenerateStructuredInput<T>): Promise<GenerateStructuredResult<T>>;

  /** 流式输出。调用方负责在客户端断开时调用 signal.abort()。 */
  streamText(input: GenerateTextInput): AsyncIterable<StreamEvent>;

  analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageResult>;
}
