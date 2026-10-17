import { z } from 'zod';
import {
  errorTypeSchema,
  gradeSchema,
  independenceSchema,
  attemptContextSchema,
  masteryLevelSchema,
  planTypeSchema,
  subjectCodeSchema,
} from '@/lib/domain/enums';

/**
 * API 请求体校验（Zod）。
 *
 * 需求：「所有写入接口都必须校验身份、请求参数和数据归属」。
 * 身份与归属在各自的路由里处理（requireUser + repository 的 userId 条件），
 * 这里只负责「请求参数长什么样」。
 *
 * 约定：
 *   - 所有可选字段用 .optional()，不设默认值的地方由服务层决定默认
 *   - 字符串长度上限一律显式声明，防止超长输入打爆提示词/数据库
 */

// -----------------------------------------------------------------------------
// 认证
// -----------------------------------------------------------------------------

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('请填写有效的邮箱地址').max(120),
  displayName: z.string().trim().min(1, '请填写昵称').max(30),
  password: z
    .string()
    .min(8, '密码至少 8 个字符')
    .max(72, '密码太长了')
    // 不强制复杂密码（面向高中生，可用性是安全的一部分），但拒绝明显弱口令
    .refine((v) => !/^(?:12345678|password|qwertyui|11111111)$/i.test(v), '这个密码太容易被猜到了'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('请填写有效的邮箱地址'),
  password: z.string().min(1, '请输入密码').max(72),
});

// -----------------------------------------------------------------------------
// 学习档案
// -----------------------------------------------------------------------------

export const profilePatchSchema = z.object({
  grade: gradeSchema.optional(),
  curriculumId: z.string().min(1).nullable().optional(),
  textbookVersion: z.string().trim().max(60).nullable().optional(),
  electiveSubjects: z.array(subjectCodeSchema).max(6).optional(),
  studyGoal: z.string().trim().max(200).nullable().optional(),
  examDate: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined || value === '' ? null : value))
    .refine(
      (value) => value === null || !Number.isNaN(new Date(value).getTime()),
      '考试日期格式不正确',
    ),
  dailyAvailableMinutes: z.number().int().min(15).max(600).optional(),
  weekdayAvailableMinutes: z.number().int().min(0).max(600).nullable().optional(),
  weekendAvailableMinutes: z.number().int().min(0).max(600).nullable().optional(),
  reminderEnabled: z.boolean().optional(),
  reminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:mm')
    .nullable()
    .optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  onboardingCompleted: z.boolean().optional(),
});

// -----------------------------------------------------------------------------
// 答疑
// -----------------------------------------------------------------------------

export const chatBodySchema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1, '请先输入问题').max(4000, '问题太长了，请拆成几段'),
  mode: z.enum(['guided', 'detailed', 'exam-review', 'quick']).default('guided'),
  subjectId: z.string().min(1).optional(),
  grade: gradeSchema.optional(),
  questionId: z.string().min(1).optional(),
});

// -----------------------------------------------------------------------------
// 题目 / 错题
// -----------------------------------------------------------------------------

export const questionCreateSchema = z.object({
  subjectId: z.string().min(1, '请选择学科'),
  grade: gradeSchema.nullable().optional(),
  chapter: z.string().trim().max(120).nullable().optional(),
  stem: z.string().trim().min(1, '请填写题干').max(6000, '题干太长了，请只保留关键部分'),
  stemFormat: z.enum(['text', 'markdown', 'latex']).default('text'),
  /**
   * 已上传图片的存储 id（来自 /api/questions/upload，服务端生成 uuid.ext）。
   *
   * 为什么要显式声明并做严格校验：这个值会被拼进文件读取路径。
   * 只接受「36 位 UUID + 白名单扩展名」这一种形态，
   * 从而在入口处就堵死 `../` 之类的路径穿越尝试。
   */
  imagePath: z
    .string()
    .trim()
    .regex(/^[0-9a-f-]{36}\.(png|jpg|webp)$/i, '图片标识不合法')
    .nullable()
    .optional(),
  choices: z.array(z.string().trim().max(500)).max(10).optional(),
  correctAnswer: z.string().trim().max(1000).nullable().optional(),
  explanation: z.string().trim().max(6000).nullable().optional(),
  sourceNote: z.string().trim().max(200).nullable().optional(),
  /** 同时创建错题记录 */
  createMistake: z.boolean().default(false),
  studentAnswer: z.string().trim().max(1000).nullable().optional(),
  /** 直接关联的知识点（手动指定时优先于 AI 匹配） */
  knowledgePointIds: z.array(z.string().min(1)).max(6).optional(),
  errorTypes: z.array(errorTypeSchema).max(4).optional(),
});

export const questionPatchSchema = z.object({
  stem: z.string().trim().min(1).max(6000).optional(),
  stemFormat: z.enum(['text', 'markdown', 'latex']).optional(),
  choices: z.array(z.string().trim().max(500)).max(10).optional(),
  correctAnswer: z.string().trim().max(1000).nullable().optional(),
  explanation: z.string().trim().max(6000).nullable().optional(),
  subjectId: z.string().min(1).optional(),
  grade: gradeSchema.nullable().optional(),
  chapter: z.string().trim().max(120).nullable().optional(),
  sourceNote: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
  /** 同时更新错题记录（学生手动修改 AI 分析结果） */
  mistake: z
    .object({
      errorTypes: z.array(errorTypeSchema).max(4).optional(),
      likelyCauses: z.array(z.string().trim().max(300)).max(5).optional(),
      explanation: z.string().trim().max(6000).nullable().optional(),
      studentAnswer: z.string().trim().max(1000).nullable().optional(),
      status: z
        .enum(['new', 'analyzing', 'needs-review', 'reviewing', 'resolved', 'archived'])
        .optional(),
    })
    .optional(),
});

export const analyzeBodySchema = z.object({
  /** 已上传图片的 id（来自 /api/questions/upload） */
  uploadId: z.string().min(1).optional(),
  stem: z.string().trim().max(6000).optional(),
  choices: z.array(z.string().trim().max(500)).max(10).optional(),
  studentAnswer: z.string().trim().max(1000).nullable().optional(),
  correctAnswer: z.string().trim().max(1000).nullable().optional(),
  subjectId: z.string().min(1).optional(),
  grade: gradeSchema.optional(),
  hint: z.string().trim().max(200).optional(),
  /** 分析完成后是否直接落库为错题 */
  createMistake: z.boolean().default(false),
});

export const attemptBodySchema = z.object({
  answer: z.string().trim().max(1000).nullable().optional(),
  isCorrect: z.boolean(),
  independence: independenceSchema.default('independent'),
  difficultySnapshot: z.number().int().min(1).max(5).default(3),
  timeSpentSeconds: z.number().int().min(0).max(36_000).nullable().optional(),
  errorTypes: z.array(errorTypeSchema).max(4).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  context: attemptContextSchema.default('practice'),
});

export const reviewBodySchema = z.object({
  result: z.enum(['correct', 'partial', 'wrong']),
  independence: independenceSchema.default('independent'),
  timeSpentSeconds: z.number().int().min(0).max(36_000).nullable().optional(),
  /** 学生自己填的答案（复习时重做） */
  answer: z.string().trim().max(1000).nullable().optional(),
});

export const questionListQuerySchema = z.object({
  subjectId: z.string().min(1).optional(),
  knowledgePointId: z.string().min(1).optional(),
  search: z.string().trim().max(120).optional(),
  source: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  onlyMistakes: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const mistakeListQuerySchema = z.object({
  subjectId: z.string().min(1).optional(),
  knowledgePointId: z.string().min(1).optional(),
  errorType: errorTypeSchema.optional(),
  status: z.string().max(40).optional(),
  reviewFilter: z.enum(['due', 'not-scheduled', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// -----------------------------------------------------------------------------
// 知识点 / 掌握度
// -----------------------------------------------------------------------------

export const knowledgePointQuerySchema = z.object({
  subjectId: z.string().min(1).optional(),
  grade: gradeSchema.optional(),
  chapter: z.string().max(120).optional(),
  search: z.string().trim().max(120).optional(),
  reviewStatus: z.enum(['draft', 'reviewed', 'deprecated']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export const masteryQuerySchema = z.object({
  subjectId: z.string().min(1).optional(),
  level: masteryLevelSchema.optional(),
  scope: z.enum(['all', 'weak', 'strong']).default('all'),
});

export const diagnoseBodySchema = z.object({
  knowledgePointIds: z.array(z.string().min(1)).min(1, '请至少选择一个知识点').max(20),
  withNarrative: z.boolean().default(false),
});

// -----------------------------------------------------------------------------
// 资源
// -----------------------------------------------------------------------------

export const resourceQuerySchema = z.object({
  knowledgePointId: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
  resourceType: z.enum(['explanation', 'example', 'practice', 'video', 'textbook', 'article']).optional(),
  verificationStatus: z.enum(['verified', 'unverified', 'unavailable']).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const resourceSearchBodySchema = z.object({
  knowledgePointId: z.string().min(1, '请选择知识点'),
  subjectId: z.string().min(1).optional(),
});

export const resourceCreateSchema = z.object({
  title: z.string().trim().min(1, '请填写标题').max(200),
  resourceType: z.enum(['explanation', 'example', 'practice', 'video', 'textbook', 'article']),
  url: z
    .string()
    .trim()
    .url('请填写完整的链接（以 http:// 或 https:// 开头）')
    .max(500)
    // 只允许 http/https，防止 javascript: 之类的危险链接被存进资源库
    .refine((v) => /^https?:\/\//i.test(v), '只允许 http 或 https 链接'),
  platform: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  content: z.string().trim().max(20_000).nullable().optional(),
  subjectId: z.string().min(1).nullable().optional(),
  grade: gradeSchema.nullable().optional(),
  difficulty: z.number().int().min(1).max(5).nullable().optional(),
  durationSeconds: z.number().int().min(1).max(36_000).nullable().optional(),
  knowledgePointIds: z.array(z.string().min(1)).max(20).optional(),
  /** 管理员标记为「已验证」时才写核验时间 */
  verified: z.boolean().default(false),
});

// -----------------------------------------------------------------------------
// 计划 / 任务
// -----------------------------------------------------------------------------

export const planGenerateBodySchema = z.object({
  planType: planTypeSchema.default('daily'),
  /** 覆盖计划天数（每日计划=1，每周计划=7） */
  dayCount: z.number().int().min(1).max(30).optional(),
  from: z.string().trim().optional(),
  /** 每日计划是否先把已有未完成任务清空后重排 */
  replaceUnfinished: z.boolean().default(false),
});

export const planQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const taskPatchSchema = z.object({
  status: z.enum(['pending', 'in-progress', 'completed', 'skipped', 'rescheduled']).optional(),
  scheduledDate: z.string().trim().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  estimatedMinutes: z.number().int().min(5).max(180).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
});

export const taskCompleteBodySchema = z.object({
  actualMinutes: z.number().int().min(0).max(600).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** 学生自评：是否真的理解了（影响掌握度证据的质量） */
  selfAssessment: z.enum(['confident', 'unsure']).default('confident'),
  accuracy: z.number().min(0).max(1).nullable().optional(),
});

// -----------------------------------------------------------------------------
// 报告 / 数据权利
// -----------------------------------------------------------------------------

export const reportQuerySchema = z.object({
  /** 0 = 本周，1 = 上周 …… */
  weekOffset: z.coerce.number().int().min(0).max(52).default(0),
});

export const dataExportBodySchema = z.object({
  format: z.enum(['json']).default('json'),
  includeConversations: z.boolean().default(false),
});
