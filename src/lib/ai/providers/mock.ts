import type {
  AnalyzeImageInput,
  GenerateStructuredInput,
  GenerateTextInput,
  ModelInfo,
  ProviderCapabilities,
} from '@/lib/ai/types';
import { AbstractAiProvider, type RawStreamChunk, type RawTextResult } from '@/lib/ai/provider';
import { AiError } from '@/lib/ai/errors';
import { messageToText } from '@/lib/ai/types';

/**
 * Mock Provider —— 没有 API Key 时也能完整开发和测试。
 *
 * ⚠️ 最重要的设计约束：**Mock 绝不编造真实的学习内容**。
 *   需求明确要求「不得编造视频、教材内容、答案来源或学习数据」。
 *   因此这里的策略是：
 *     - 结构化输出返回**结构完全正确但内容为占位说明**的对象，
 *       并在 confidence 上给 0、在文本里显式标注这是 Mock 结果；
 *     - 界面上会据此显示「示例数据，请手动核对」，学生不会被假答案误导；
 *     - 永远不假装自己识别出了题目内容。
 *
 * 它同时是「结构化输出链路 + 错误处理 + 日志」的测试替身，
 * 让自动化测试可以完全离线运行。
 */

const MOCK_NOTICE = '（当前为 Mock 模式：未接入真实模型，以下为示例结构，请手动核对内容。）';

export class MockAiProvider extends AbstractAiProvider {
  readonly id = 'mock';
  readonly label = 'Mock Provider（离线开发用）';
  readonly defaultModel = 'mock-study-coach';
  override readonly visionModel = 'mock-vision';

  protected declareCapabilities(): ProviderCapabilities {
    return {
      text: true,
      streaming: true,
      structured: true,
      // Mock 声明支持图片理解，但它返回的仍是占位内容 —— 界面上会明确标注，
      // 从而让「图片上传 → 人工确认」这条链路在没有视觉模型时也能被开发和测试。
      vision: true,
      maxInputChars: 48_000,
      structuredFallback: 'json-mode',
    };
  }

  override async getAvailableModels(): Promise<ModelInfo[]> {
    return [
      { id: 'mock-study-coach', label: 'Mock 文本模型', vision: false },
      { id: 'mock-vision', label: 'Mock 视觉模型（仅占位）', vision: true },
    ];
  }

  protected async rawGenerateText(
    input: GenerateTextInput,
    ctx: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ): Promise<RawTextResult> {
    if (ctx.signal.aborted) {
      throw new AiError('AI_ABORTED', { message: '已取消' });
    }

    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    const question = lastUser ? messageToText(lastUser).slice(0, 200) : '';
    const service = input.service;

    const text = [
      `> ${MOCK_NOTICE}`,
      '',
      `**服务**：\`${service}\`　**模型**：\`${ctx.model}\``,
      '',
      '### 我收到了你的问题',
      question ? `> ${question.replace(/\n/g, '\n> ')}` : '（没有收到问题内容）',
      '',
      '### 接下来怎么用真实模型',
      '1. 在项目根目录的 `.env` 中设置：',
      '   ```',
      '   AI_PROVIDER=deepseek',
      '   AI_API_KEY=你的密钥',
      '   AI_MODEL=deepseek-chat',
      '   ```',
      '2. 重启开发服务器（`npm run dev`）。',
      '3. 回到这个页面重新提问，就会得到真实讲解。',
      '',
      '### 为什么现在是这个样子',
      'Mock Provider 刻意**不生成**看起来像真答案的解题过程 ——',
      '那样会让你误以为这就是正确解法。它只负责把整条链路（提问 → 流式输出 → 记录 → 日志）跑通。',
      '',
      '### 一个可以马上做的事',
      '打开「错题本」手动录入一道题，把知识点关联上，',
      '再去「学习计划」生成今天的任务 —— 这些功能不依赖 AI，现在就是真实可用的。',
    ].join('\n');

    return { text, model: ctx.model, finishReason: 'stop' };
  }

  /**
   * Mock 的结构化输出：返回**结构合法**但内容为空壳的对象。
   * 这样服务层的 Zod 校验、字段映射、后续落库流程都能被真实测试到。
   */
  protected override async rawGenerateJson(
    input: GenerateStructuredInput<unknown>,
    _ctx: { model: string; signal: AbortSignal; maxOutputTokens: number; repairHint?: string },
  ): Promise<RawTextResult> {
    // 把 schema 的「形状」推断出来，生成一份结构正确的空壳。
    const shape = shapeFromSchemaName(input.schemaName);

    return {
      text: JSON.stringify(shape),
      model: this.defaultModel,
      finishReason: 'stop',
    };
  }

  protected async rawAnalyzeImage(
    input: AnalyzeImageInput,
    ctx: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ): Promise<RawTextResult> {
    void input;
    return {
      // 关键：不描述图片内容。只返回一个 JSON，让界面进入「人工确认」流程。
      text: JSON.stringify({
        mock: true,
        notice: MOCK_NOTICE,
        subject: '',
        stem: '',
        choices: [],
        correctAnswer: '',
        explanation: '',
        knowledgePoints: [],
        confidence: 0,
        needsUserConfirmation: true,
      }),
      model: ctx.model,
      finishReason: 'stop',
    };
  }

  protected override rawStreamText(
    _input: GenerateTextInput,
    _ctx: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ): AsyncIterable<RawStreamChunk> | null {
    // 由基类的非流式回退负责分块吐出，保证「流式」这条链路也能被测试。
    return null;
  }
}

/**
 * 按 schemaName 给出结构正确的空壳。
 * 之所以按名字硬编码而不是自动从 Zod 反射：这里只需要覆盖本项目的几个固定 schema，
 * 硬编码更容易审查，也避免引入脆弱的反射逻辑。
 */
function shapeFromSchemaName(schemaName: string): Record<string, unknown> {
  switch (schemaName) {
    case 'QuestionAnalysis':
      return {
        subject: '',
        knowledgePoints: [],
        errorTypes: [],
        likelyCauses: [],
        explanation: '',
        prerequisites: [],
        recommendedActions: [],
        confidence: 0,
        mock: true,
      };
    case 'KnowledgeDiagnosisNarrative':
      return {
        summary: '',
        evidence: [],
        nextActions: [],
        uncertainty: MOCK_NOTICE,
        confidence: 0,
        mock: true,
      };
    case 'StudyPlanSuggestion':
      return {
        tasks: [],
        rationale: MOCK_NOTICE,
        confidence: 0,
        mock: true,
      };
    case 'ResourceMatchSuggestion':
      return {
        searchKeywords: [],
        notes: MOCK_NOTICE,
        confidence: 0,
        mock: true,
      };
    default:
      return { mock: true, notice: MOCK_NOTICE, confidence: 0 };
  }
}

/** 供测试使用：确认 Mock 输出里确实没有伪造的解题内容。 */
export function isMockNotice(text: string): boolean {
  return text.includes('Mock 模式');
}
