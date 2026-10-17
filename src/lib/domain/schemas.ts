import { z } from 'zod';
import { errorTypeSchema, gradeSchema, masteryLevelSchema, taskTypeSchema } from '@/lib/domain/enums';

/**
 * 结构化输出的运行时 Schema。
 *
 * 需求明确要求：「实际输出必须使用正式类型和运行时校验，不能直接信任模型返回的 JSON」。
 * 因此所有 AI 结构化输出都必须在这里定义 Schema，
 * 由 AbstractAiProvider.generateStructured() 做 Zod 校验 + 修复重试。
 *
 * 设计约定：
 *   - 所有字段给 default，避免模型漏字段导致整体失败；
 *   - 未知枚举值不通过校验（宁可重试，也不要落库脏数据）；
 *   - 数值字段做范围限制，防止模型返回 999 这种分数。
 */

// -----------------------------------------------------------------------------
// 错题分析（对应需求第六节给出的 JSON 示例）
// -----------------------------------------------------------------------------

export const questionAnalysisSchema = z.object({
  /** 学科代码（math/physics/...）或中文名；由上层的模糊匹配归一 */
  subject: z.string().default(''),

  /** 从图片/文本中识别出的题干原文。识别不出时留空，不要编造。 */
  stem: z.string().default(''),
  /** 选择题选项；非选择题为空数组 */
  choices: z.array(z.string()).max(10).default([]),
  /** 正确答案。不确定时留空，由学生/老师核对。 */
  correctAnswer: z.string().default(''),

  /** 详细解析 */
  explanation: z.string().default(''),

  /** 命中的知识点 **code**（必须来自传入的目录；匹配不上返回空数组） */
  knowledgePoints: z.array(z.string()).max(6).default([]),

  /** 错误原因分类（多选） */
  errorTypes: z.array(errorTypeSchema).max(4).default([]),

  /** 对错误原因的自然语言解释（与分类不同，这里有推理过程） */
  likelyCauses: z.array(z.string()).max(5).default([]),

  /** 解题依赖的前置知识（自然语言名称） */
  prerequisites: z.array(z.string()).max(6).default([]),

  /** 推荐的下一步动作 */
  recommendedActions: z.array(z.string()).max(4).default([]),

  /** 对「错误原因判断」的置信度 0..1 */
  confidence: z.number().min(0).max(1).default(0),

  /** 题干缺失/不清晰/有歧义时置 true —— 界面会转成「请学生确认」而不是当成结论 */
  needsUserConfirmation: z.boolean().default(false),

  /** Mock Provider 会带上这个标记，界面据此显示「示例数据」提示 */
  mock: z.boolean().optional(),
  notice: z.string().optional(),
});

export type QuestionAnalysisOutput = z.infer<typeof questionAnalysisSchema>;

// -----------------------------------------------------------------------------
// 知识诊断叙述（等级由算法给定，AI 只做解释）
// -----------------------------------------------------------------------------

export const diagnosisNarrativeSchema = z.object({
  /** 120 字以内的总体说明 */
  summary: z.string().default(''),
  /** 每条判断对应的证据引用 */
  evidence: z
    .array(
      z.object({
        /** 引用的证据描述，例如「最近 3 次里 2 次符号写错」 */
        observation: z.string().default(''),
        /** 指向的作答记录 id（若 AI 无法确定可留空，不会影响落库） */
        attemptId: z.string().optional(),
      }),
    )
    .max(6)
    .default([]),
  /** 具体可执行的下一步动作 */
  nextActions: z.array(z.string()).max(3).default([]),
  /** 这个判断的不确定之处 —— 必须如实写出 */
  uncertainty: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0),
  mock: z.boolean().optional(),
});

export type DiagnosisNarrativeOutput = z.infer<typeof diagnosisNarrativeSchema>;

// -----------------------------------------------------------------------------
// 学习计划措辞润色（可选，不改变任务本身）
// -----------------------------------------------------------------------------

export const studyPlanPolishSchema = z.object({
  /** 与输入任务一一对应的推荐理由（顺序必须一致） */
  reasons: z.array(z.string()).max(20).default([]),
  /** 给学生的整体说明 */
  overview: z.string().default(''),
  mock: z.boolean().optional(),
});

export type StudyPlanPolishOutput = z.infer<typeof studyPlanPolishSchema>;

// -----------------------------------------------------------------------------
// 资源匹配（只生成检索关键词，不生成资源本身）
// -----------------------------------------------------------------------------

export const resourceMatchSchema = z.object({
  /**
   * 用于检索的关键词/短语。
   * ⚠️ 刻意不返回具体视频标题或链接 —— 那些必须来自真实资源库或真实搜索 API，
   *    否则就是「编造视频标题、链接、时长」（需求明令禁止）。
   */
  searchKeywords: z.array(z.string()).max(6).default([]),
  /** 说明为什么这些关键词有帮助 */
  notes: z.string().default(''),
  mock: z.boolean().optional(),
});

export type ResourceMatchOutput = z.infer<typeof resourceMatchSchema>;

// -----------------------------------------------------------------------------
// 请求体校验（API 层使用）
// -----------------------------------------------------------------------------

export const teachingModeBodySchema = z.enum(['guided', 'detailed', 'exam-review', 'quick']);

export const chatRequestSchema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1, '请先输入问题').max(4000, '问题太长了，请拆成几段'),
  mode: teachingModeBodySchema.default('guided'),
  subjectId: z.string().min(1).optional(),
  grade: gradeSchema.optional(),
  /** 从错题本发起追问时带上 */
  questionId: z.string().min(1).optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const taskTypeBodySchema = taskTypeSchema;
export const masteryLevelBodySchema = masteryLevelSchema;
