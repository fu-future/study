/**
 * 浏览器端的统一 API 调用助手。
 *
 * 后端约定（见 src/lib/api/http.ts）：
 *   成功：{ ok: true, data: T }
 *   失败：{ ok: false, error: { code, message, details? } }
 *
 * 这一层做三件事，其余地方就不用重复写：
 *   1. 解包出 `data`，失败统一抛 `ApiError`
 *   2. 把后端的字段级 details 解析成 `fieldErrors`，表单可以直接喂给 <Field error>
 *   3. 把网络异常/非 JSON 响应也归一成 `ApiError`，界面只需要处理一种错误类型
 *
 * 注意：本文件只依赖 fetch，可在客户端组件中使用；
 * 不要在这里引入任何服务端模块（env / prisma / registry），否则会被打进浏览器包。
 */

// -----------------------------------------------------------------------------
// 分支：错误类型
// -----------------------------------------------------------------------------

/** 后端 Zod 校验失败时回传的字段级错误：{ 字段名: 提示 } */
export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly fieldErrors: FieldErrors;

  constructor(
    message: string,
    options: { code?: string; status?: number; details?: unknown; fieldErrors?: FieldErrors } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code ?? 'UNKNOWN';
    this.status = options.status ?? 0;
    this.details = options.details;
    this.fieldErrors = options.fieldErrors ?? {};
  }

  /** 会话失效：调用方通常应该跳回登录页 */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.code === 'UNAUTHORIZED';
  }

  /** 限流：可以提示「稍后再试」 */
  get isRateLimited(): boolean {
    return this.status === 429 || this.code === 'RATE_LIMITED';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** 把任意异常转成可直接展示给学生的中文提示（不泄露内部细节）。 */
export function toUserMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.name === 'AbortError') return '已停止这次请求。';
  return '网络好像不太稳定，请稍后重试。';
}

function toFieldErrors(details: unknown): FieldErrors {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  const result: FieldErrors = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (typeof value === 'string' && value) result[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') result[key] = value[0];
  }
  return result;
}

// -----------------------------------------------------------------------------
// 分支：通用请求
// -----------------------------------------------------------------------------

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** 传普通对象时会自动 JSON 序列化；传 FormData 时原样发送 */
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** 是否带上 cookies（默认 same-origin 已包含，跨域时才需要） */
  credentials?: RequestCredentials;
};

export async function apiRequest<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, headers = {}, credentials } = options;

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal,
      ...(credentials ? { credentials } : {}),
      headers: {
        ...(isFormData || body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Accept: 'application/json',
        ...headers,
      },
      ...(body === undefined ? {} : { body: isFormData ? (body as FormData) : JSON.stringify(body) }),
    });
  } catch (error) {
    // 主动取消不当作错误处理，交给调用方识别 AbortError
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('连接不上服务器，请检查网络后重试。', {
      code: 'NETWORK_ERROR',
      status: 0,
      details: error instanceof Error ? error.message : String(error),
    });
  }

  if (response.status === 204) return undefined as T;

  const raw = await response.text();
  let parsed: unknown = null;
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  const envelope = parsed as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; details?: unknown } }
    | null;

  if (envelope && typeof envelope === 'object' && 'ok' in envelope) {
    if (envelope.ok) return envelope.data;

    throw new ApiError(envelope.error?.message || '操作没有成功，请稍后重试。', {
      code: envelope.error?.code ?? 'UNKNOWN',
      status: response.status,
      details: envelope.error?.details,
      fieldErrors: toFieldErrors(envelope.error?.details),
    });
  }

  // 非标准响应（例如代理返回的 HTML 错误页、文件流）
  throw new ApiError(
    response.ok
      ? '服务返回的数据格式和预期不一致。'
      : `请求没有成功（状态码 ${response.status}），请稍后重试。`,
    { code: 'UNEXPECTED_RESPONSE', status: response.status, details: raw.slice(0, 500) },
  );
}

export function apiGet<T>(url: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
  return apiRequest<T>(url, { ...options, method: 'GET' });
}

export function apiPost<T>(url: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return apiRequest<T>(url, { ...options, method: 'POST', body });
}

export function apiPatch<T>(url: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return apiRequest<T>(url, { ...options, method: 'PATCH', body });
}

export function apiDelete<T>(url: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return apiRequest<T>(url, { ...options, method: 'DELETE', body });
}

/** 拼接查询串，自动跳过空值。 */
export function withQuery(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

// -----------------------------------------------------------------------------
// 分支：共享 DTO（与 API 契约一一对应）
// -----------------------------------------------------------------------------

export type SubjectDto = {
  id: string;
  code: string;
  name: string;
  isElective: boolean;
};

export type KnowledgePointDto = {
  id: string;
  code: string;
  name: string;
  subjectId: string;
  subjectName?: string;
  grade: string;
  chapter: string;
  chapterPath: string;
  depth: number;
  difficulty: number;
  description: string | null;
  commonMistakes: string[];
  typicalQuestionTypes: string[];
  reviewStatus: string;
  parentId: string | null;
  mastery: MasterySummaryDto | null;
};

export type MasterySummaryDto = {
  knowledgePointId: string;
  knowledgePointName: string;
  subjectId: string;
  subjectName: string;
  chapterPath: string;
  difficulty: number;
  level: string;
  levelLabel: string;
  score: number | null;
  confidence: number;
  evidenceCount: number;
  recentAccuracy: number | null;
  recentSampleSize: number;
  repeatedErrorTypes: Record<string, number>;
  needsPrerequisiteReview: boolean;
  nextAction: string | null;
  lastEvaluatedAt: string | null;
};

export type MistakeSummaryDto = {
  id: string;
  status: string;
  studentAnswer: string | null;
  errorTypes: string[];
  likelyCauses: string[];
  errorConfidence: number | null;
  editedByUser: boolean;
  attemptCount: number;
  correctCount: number;
  lastReviewedAt: string | null;
  lastReviewResult: string | null;
  nextReviewAt: string | null;
  confidenceNote: string;
};

export type QuestionSummaryDto = {
  id: string;
  stem: string;
  stemFormat: string;
  choices: string[];
  subjectId: string;
  subjectName: string;
  grade: string | null;
  chapter: string | null;
  correctAnswer: string | null;
  explanation: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  source: string;
  sourceNote: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  knowledgePoints: { id: string; name: string; chapterPath: string; isPrimary: boolean }[];
  mistake: MistakeSummaryDto | null;
};

export type ResourceDto = {
  id: string;
  title: string;
  resourceType: string;
  provider: string;
  platform: string | null;
  url: string;
  verificationStatus: string;
  lastVerifiedAt: string | null;
  durationSeconds: number | null;
  description: string | null;
  subjectId: string | null;
  grade: string | null;
  difficulty: number | null;
};

export type InternalMaterialDto = {
  kind: 'explanation' | 'practice';
  title: string;
  content: string;
  isMock: boolean;
  model: string | null;
};

export type ResourceSearchResultDto = {
  knowledgePoint: {
    id: string;
    name: string;
    chapterPath: string;
    subjectId: string;
    subjectName: string;
    grade: string;
    difficulty: number;
    commonMistakes: string[];
    typicalQuestionTypes: string[];
  };
  verified: ResourceDto[];
  unverified: ResourceDto[];
  internal: InternalMaterialDto[];
  degraded: boolean;
  message: string | null;
  searchKeywords: string[];
  searchError: string | null;
};

export type ConversationDto = {
  id: string;
  title: string;
  mode: string;
  subjectId: string | null;
  subjectName: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessageDto = {
  id: string;
  role: string;
  content: string;
  contentType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ConversationDetailDto = {
  conversation: {
    id: string;
    title: string;
    mode: string;
    subjectId: string | null;
    questionId: string | null;
  };
  messages: ConversationMessageDto[];
};

export type QuestionUploadDto = {
  uploadId: string;
  mimeType: string;
  bytes: number;
  url: string;
};

export type QuestionAnalysisDto = {
  analysis: {
    subject: string;
    stem: string;
    choices: string[];
    correctAnswer: string;
    explanation: string;
    knowledgePoints: string[];
    errorTypes: string[];
    likelyCauses: string[];
    prerequisites: string[];
    recommendedActions: string[];
    confidence: number;
    needsUserConfirmation: boolean;
    mock?: boolean;
  };
  matchedKnowledgePoints: { id: string; code: string; name: string; chapterPath: string }[];
  rejectedKnowledgePointCodes: string[];
  model: string;
  providerId: string;
  latencyMs: number;
  isMock: boolean;
  needsUserConfirmation: boolean;
  question?: QuestionSummaryDto;
  mistakeCreated?: boolean;
  firstReview?: { dueAt: string; intervalDays: number } | null;
};

export type ReviewOutcomeDto = {
  attempt: { id: string; isCorrect: boolean; independence: string; context: string; createdAt: string };
  review: { dueAt: string; intervalDays: number; repetition: number; easeFactor: number; overdueDays: number } | null;
  mastery: {
    knowledgePointId: string;
    knowledgePointName: string;
    level: string;
    score: number | null;
    confidence: number;
    evidenceCount: number;
    recentAccuracy: number | null;
    needsPrerequisiteReview: boolean;
    nextAction: string | null;
  }[];
};

export type StudyTaskDto = {
  id: string;
  title: string;
  subjectId: string | null;
  subjectName: string | null;
  knowledgePointId: string | null;
  knowledgePointName: string | null;
  taskType: string;
  estimatedMinutes: number;
  reason: string;
  completionCriteria: string | null;
  priority: number;
  status: string;
  scheduledDate: string;
  dueDate: string | null;
};

export type GeneratePlanResultDto = {
  plan: { id: string; title: string; planType: string; status: string };
  tasks: StudyTaskDto[];
  minutesByDay: { date: string; minutes: number; availableMinutes: number }[];
  trimmedCount: number;
  totalMinutes: number;
};

export type ProfileDto = {
  id: string;
  grade: string;
  curriculumId: string | null;
  textbookVersion: string | null;
  electiveSubjects: string[];
  studyGoal: string | null;
  examDate: string | null;
  dailyAvailableMinutes: number;
  weekdayAvailableMinutes: number | null;
  weekendAvailableMinutes: number | null;
  reminderEnabled: boolean;
  reminderTime: string | null;
  onboardingCompleted: boolean;
};
