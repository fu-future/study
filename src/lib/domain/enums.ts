import { z } from 'zod';

/**
 * 领域枚举的单一事实来源。
 *
 * 为什么用「字符串常量 + Zod」而不是 Prisma 原生 enum：
 *   第一阶段数据源是 SQLite，SQLite 不支持原生 enum。为了让同一个数据模型
 *   在 SQLite 与 PostgreSQL 上都成立（见 prisma/schema.prisma 顶部约定），
 *   枚举值统一以字符串落库，取值域由本文件在**写入前**强制校验。
 *   类型安全因此在应用层得到保证，而不是依赖某一种数据库方言。
 */

// -----------------------------------------------------------------------------
// 通用 helper
// -----------------------------------------------------------------------------

/**
 * 把「英文稳定码 → 中文标签」的映射转成 Zod enum。
 * 落库存英文码（稳定、可迁移），界面展示中文标签。
 */
function codesOf<T extends Record<string, string>>(map: T): [keyof T & string, ...(keyof T & string)[]] {
  const keys = Object.keys(map) as (keyof T & string)[];
  if (keys.length === 0) throw new Error('枚举映射不能为空');
  return keys as [keyof T & string, ...(keyof T & string)[]];
}

// -----------------------------------------------------------------------------
// 学科
// -----------------------------------------------------------------------------

export const SUBJECTS = {
  chinese: '语文',
  math: '数学',
  english: '英语',
  physics: '物理',
  chemistry: '化学',
  biology: '生物',
  history: '历史',
  geography: '地理',
  politics: '思想政治',
} as const;

export type SubjectCode = keyof typeof SUBJECTS;
export const subjectCodeSchema = z.enum(codesOf(SUBJECTS));
export const SUBJECT_CODES = codesOf(SUBJECTS);

/** 数学 / 物理 / 化学：答疑时应展示公式、单位与适用条件 */
export const STEM_SUBJECTS: SubjectCode[] = ['math', 'physics', 'chemistry'];
/** 语文 / 英语：按题型给文本分析、语法解释、词汇讲解、例句 */
export const LANGUAGE_SUBJECTS: SubjectCode[] = ['chinese', 'english'];

export function subjectLabel(code: string): string {
  return (SUBJECTS as Record<string, string>)[code] ?? code;
}

// -----------------------------------------------------------------------------
// 年级
// -----------------------------------------------------------------------------

export const GRADES = ['高一', '高二', '高三'] as const;
export type Grade = (typeof GRADES)[number];
export const gradeSchema = z.enum(GRADES);

// -----------------------------------------------------------------------------
// 掌握程度（核心诊断输出）
// -----------------------------------------------------------------------------

export const MASTERY_LEVELS = {
  unevaluated: '未评估',
  insufficient: '证据不足',
  learning: '正在学习',
  initial: '初步掌握',
  basic: '基本掌握',
  stable: '稳定掌握',
} as const;

export type MasteryLevel = keyof typeof MASTERY_LEVELS;
export const masteryLevelSchema = z.enum(codesOf(MASTERY_LEVELS));
export const MASTERY_LEVEL_CODES = codesOf(MASTERY_LEVELS);

/** 展示顺序（弱 → 强），用于排序与进度可视化 */
export const MASTERY_ORDER: MasteryLevel[] = [
  'unevaluated',
  'insufficient',
  'learning',
  'initial',
  'basic',
  'stable',
];

export function masteryRank(level: MasteryLevel): number {
  return MASTERY_ORDER.indexOf(level);
}

export function masteryLabel(level: string): string {
  return (MASTERY_LEVELS as Record<string, string>)[level] ?? level;
}

// -----------------------------------------------------------------------------
// 错误原因分类
// -----------------------------------------------------------------------------

export const ERROR_TYPES = {
  concept: '概念理解错误',
  formula: '公式或定义记忆错误',
  reading: '审题错误',
  calculation: '计算或符号错误',
  method: '解题方法选择错误',
  'incomplete-reasoning': '推理步骤不完整',
  transfer: '知识迁移困难',
  'time-management': '时间管理问题',
  unknown: '暂时无法判断',
} as const;

export type ErrorType = keyof typeof ERROR_TYPES;
export const errorTypeSchema = z.enum(codesOf(ERROR_TYPES));
export const ERROR_TYPE_CODES = codesOf(ERROR_TYPES);
export const errorTypesSchema = z.array(errorTypeSchema).max(ERROR_TYPE_CODES.length);

export function errorTypeLabel(code: string): string {
  return (ERROR_TYPES as Record<string, string>)[code] ?? code;
}

// -----------------------------------------------------------------------------
// 答疑模式
// -----------------------------------------------------------------------------

export const TEACHING_MODES = {
  guided: '引导模式',
  detailed: '详细讲解模式',
  'exam-review': '考试复盘模式',
  quick: '快速答疑模式',
} as const;

export type TeachingMode = keyof typeof TEACHING_MODES;
export const teachingModeSchema = z.enum(codesOf(TEACHING_MODES));
export const DEFAULT_TEACHING_MODE: TeachingMode = 'guided';
export const TEACHING_MODE_CODES = codesOf(TEACHING_MODES);

export function teachingModeLabel(code: string): string {
  return (TEACHING_MODES as Record<string, string>)[code] ?? code;
}

// -----------------------------------------------------------------------------
// 任务类型 / 计划类型
// -----------------------------------------------------------------------------

export const TASK_TYPES = {
  explanation: '知识讲解',
  video: '视频学习',
  example: '例题分析',
  practice: '独立练习',
  review: '错题复习',
  retest: '阶段复测',
} as const;

export type TaskType = keyof typeof TASK_TYPES;
export const taskTypeSchema = z.enum(codesOf(TASK_TYPES));
export const TASK_TYPE_CODES = codesOf(TASK_TYPES);

export function taskTypeLabel(code: string): string {
  return (TASK_TYPES as Record<string, string>)[code] ?? code;
}

export const PLAN_TYPES = {
  daily: '每日计划',
  weekly: '每周计划',
  'exam-prep': '考前复习计划',
  'weak-point': '薄弱知识专项',
  'mistake-review': '错题复习计划',
  makeup: '临时补课任务',
} as const;

export type PlanType = keyof typeof PLAN_TYPES;
export const planTypeSchema = z.enum(codesOf(PLAN_TYPES));
export const PLAN_TYPE_CODES = codesOf(PLAN_TYPES);

export function planTypeLabel(code: string): string {
  return (PLAN_TYPES as Record<string, string>)[code] ?? code;
}

// -----------------------------------------------------------------------------
// 各种状态
// -----------------------------------------------------------------------------

export const TASK_STATUSES = {
  pending: '待开始',
  'in-progress': '进行中',
  completed: '已完成',
  skipped: '已跳过',
  rescheduled: '已重排',
} as const;
export const taskStatusSchema = z.enum(codesOf(TASK_STATUSES));
export type TaskStatus = keyof typeof TASK_STATUSES;

export const PLAN_STATUSES = {
  draft: '草稿',
  active: '进行中',
  completed: '已完成',
  archived: '已归档',
} as const;
export const planStatusSchema = z.enum(codesOf(PLAN_STATUSES));

export const WRONG_RECORD_STATUSES = {
  new: '新录入',
  analyzing: '分析中',
  'needs-review': '待复习',
  reviewing: '复习中',
  resolved: '已订正',
  archived: '已归档',
} as const;
export const wrongRecordStatusSchema = z.enum(codesOf(WRONG_RECORD_STATUSES));

export const REVIEW_STATUSES = {
  scheduled: '已安排',
  done: '已完成',
  skipped: '已跳过',
} as const;
export const reviewStatusSchema = z.enum(codesOf(REVIEW_STATUSES));

/** 单次复习结果 */
export const REVIEW_RESULTS = {
  correct: '答对',
  partial: '部分正确',
  wrong: '答错',
} as const;
export const reviewResultSchema = z.enum(codesOf(REVIEW_RESULTS));
export type ReviewResult = keyof typeof REVIEW_RESULTS;

/** 作答场景 */
export const ATTEMPT_CONTEXTS = {
  initial: '首次录入',
  practice: '练习',
  review: '错题复习',
  retest: '复测',
} as const;
export const attemptContextSchema = z.enum(codesOf(ATTEMPT_CONTEXTS));
export type AttemptContext = keyof typeof ATTEMPT_CONTEXTS;

/**
 * 独立完成程度 —— 掌握度算法的关键输入。
 * 「看了讲解才做对」不能算作掌握，所以必须区分。
 */
export const INDEPENDENCE_LEVELS = {
  independent: '独立完成',
  'with-hint': '看提示后完成',
  'with-solution': '看解析后完成',
} as const;
export const independenceSchema = z.enum(codesOf(INDEPENDENCE_LEVELS));
export type Independence = keyof typeof INDEPENDENCE_LEVELS;

// -----------------------------------------------------------------------------
// 学习资源
// -----------------------------------------------------------------------------

export const RESOURCE_TYPES = {
  explanation: '知识讲解',
  example: '典型例题',
  practice: '针对性练习',
  video: '视频课程',
  textbook: '教材',
  article: '文章',
} as const;
export const resourceTypeSchema = z.enum(codesOf(RESOURCE_TYPES));

/**
 * 资源核验状态 —— 必须明确区分「已验证」与「未经核验的搜索结果」。
 * verified：人工（管理员）核验过链接与内容
 * unverified：来自外部搜索，未核验，界面上必须显式标注
 * unavailable：链接失效
 */
export const RESOURCE_VERIFICATION = {
  verified: '已验证',
  unverified: '未核验',
  unavailable: '已失效',
} as const;
export const resourceVerificationSchema = z.enum(codesOf(RESOURCE_VERIFICATION));
export type ResourceVerification = keyof typeof RESOURCE_VERIFICATION;

// -----------------------------------------------------------------------------
// 知识点审核状态
// -----------------------------------------------------------------------------

/**
 * AI 临时生成的知识点只能是 draft，不得直接当成经过审核的官方课程目录。
 */
export const KP_REVIEW_STATUS = {
  draft: '待审核',
  reviewed: '已审核',
  deprecated: '已废弃',
} as const;
export const kpReviewStatusSchema = z.enum(codesOf(KP_REVIEW_STATUS));

export const KP_SOURCES = {
  manual: '人工录入',
  'csv-import': '批量导入',
  'ai-draft': 'AI 草稿',
  'demo-seed': '演示数据',
} as const;
export const kpSourceSchema = z.enum(codesOf(KP_SOURCES));

// -----------------------------------------------------------------------------
// 模型调用状态
// -----------------------------------------------------------------------------

export const MODEL_CALL_STATUSES = {
  success: '成功',
  error: '失败',
  timeout: '超时',
  'rate-limited': '被限流',
  unsupported: '功能不支持',
} as const;
export type ModelCallStatus = keyof typeof MODEL_CALL_STATUSES;
