import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * E2E 测试辅助：账号、题目、作答等。
 *
 * 设计要点：
 *   - 每个用例用**独立账号**（邮箱带随机后缀），彼此数据完全隔离，
 *     因此可以并行/重复运行而不会相互干扰，也不需要清库。
 *   - 数据准备优先走真实 HTTP 接口（而不是直接写数据库）：
 *     这样"接口 + 服务 + 数据库"三者一起被验证，才是真正的端到端。
 */

export type TestUser = {
  email: string;
  password: string;
  displayName: string;
  userId: string;
};

let counter = 0;

function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const DEFAULT_PASSWORD = 'e2e-study-coach-2026';

/**
 * 注册一个隔离的测试账号。
 *
 * @param context 建议传 `page.request`（与页面共享 Cookie），这样注册完就是已登录状态
 */
export async function registerTestUser(
  context: APIRequestContext,
  overrides: Partial<{ email: string; password: string; displayName: string }> = {},
): Promise<TestUser> {
  const email = overrides.email ?? `e2e-${uniqueSuffix()}@study.test`;
  const password = overrides.password ?? DEFAULT_PASSWORD;
  const displayName = overrides.displayName ?? '测试学生';

  const response = await context.post('/api/auth/register', {
    data: { email, displayName, password },
  });

  expect(response.status(), `注册失败：${await response.text()}`).toBe(200);

  const body = (await response.json()) as { ok: boolean; data: { user: { id: string } } };
  expect(body.ok).toBe(true);

  return { email, password, displayName, userId: body.data.user.id };
}

/**
 * 完成首次建档（把 onboardingCompleted 置为 true）。
 *
 * 为什么需要：新用户第一次进入会被引导到建档向导，
 * 需要操作应用内页面的用例应当先完成建档，否则会被重定向到 /onboarding。
 * 走的是真实的 PATCH /api/profile 接口，不是直接改数据库。
 */
export async function completeOnboarding(
  context: APIRequestContext,
  options: { grade?: string; dailyAvailableMinutes?: number } = {},
): Promise<void> {
  const response = await context.patch('/api/profile', {
    data: {
      grade: options.grade ?? '高二',
      textbookVersion: '人教A版',
      electiveSubjects: ['physics', 'chemistry'],
      dailyAvailableMinutes: options.dailyAvailableMinutes ?? 90,
      studyGoal: 'E2E 测试目标：把薄弱章节补上',
      onboardingCompleted: true,
    },
  });

  expect(response.status(), `完成建档失败：${await response.text()}`).toBe(200);
}

/** 注册一个已经完成建档的账号（大多数应用内用例用这个） */
export async function registerOnboardedUser(
  context: APIRequestContext,
  options: { grade?: string; dailyAvailableMinutes?: number } = {},
): Promise<TestUser> {
  const user = await registerTestUser(context);
  await completeOnboarding(context, options);
  return user;
}

/** 读取学科列表并返回数学学科 id（seed 数据里有数学） */export async function getMathSubjectId(context: APIRequestContext): Promise<string> {
  const response = await context.get('/api/subjects');
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    data: { items: { id: string; code: string; name: string }[] };
  };

  const math = body.data.items.find((item) => item.code === 'math');
  expect(math, 'seed 数据里应当存在数学学科').toBeTruthy();
  return math!.id;
}

/** 取一个"已审核"的知识点（seed 数据提供），用于关联题目 */
export async function getReviewedKnowledgePoint(
  context: APIRequestContext,
  options: { subjectId?: string } = {},
): Promise<{ id: string; name: string; chapterPath: string }> {
  const query = new URLSearchParams({ reviewStatus: 'reviewed', limit: '50' });
  if (options.subjectId) query.set('subjectId', options.subjectId);

  const response = await context.get(`/api/knowledge-points?${query.toString()}`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    data: { items: { id: string; name: string; chapterPath: string }[] };
  };

  expect(body.data.items.length, 'seed 数据里应当存在已审核知识点').toBeGreaterThan(0);
  const first = body.data.items[0]!;
  return { id: first.id, name: first.name, chapterPath: first.chapterPath };
}

/** 创建一道错题（题目 + 错题记录 + 首次复习计划），返回题目 id */
export async function createMistakeQuestion(
  context: APIRequestContext,
  options: {
    subjectId: string;
    stem: string;
    knowledgePointIds?: string[];
    studentAnswer?: string;
    correctAnswer?: string;
    errorTypes?: string[];
  },
): Promise<string> {
  const response = await context.post('/api/questions', {
    data: {
      subjectId: options.subjectId,
      stem: options.stem,
      stemFormat: 'text',
      correctAnswer: options.correctAnswer ?? '标准答案（E2E 测试数据）',
      explanation: 'E2E 测试用解析。',
      sourceNote: 'E2E 测试数据',
      createMistake: true,
      studentAnswer: options.studentAnswer ?? '我的错误答案',
      errorTypes: options.errorTypes ?? ['calculation'],
      knowledgePointIds: options.knowledgePointIds ?? [],
    },
  });

  expect(response.status(), `创建错题失败：${await response.text()}`).toBe(200);

  const body = (await response.json()) as { data: { question: { id: string } } };
  return body.data.question.id;
}

/** 提交一次作答 */
export async function submitAttempt(
  context: APIRequestContext,
  questionId: string,
  options: {
    isCorrect: boolean;
    independence?: 'independent' | 'with-hint' | 'with-solution';
    difficulty?: number;
    context?: 'initial' | 'practice' | 'review' | 'retest';
    errorTypes?: string[];
    answer?: string;
  },
): Promise<{
  mastery: {
    knowledgePointId: string;
    level: string;
    score: number | null;
    confidence: number;
    evidenceCount: number;
  }[];
}> {
  const response = await context.post(`/api/questions/${questionId}/attempts`, {
    data: {
      isCorrect: options.isCorrect,
      independence: options.independence ?? 'independent',
      difficultySnapshot: options.difficulty ?? 3,
      context: options.context ?? 'practice',
      errorTypes: options.errorTypes ?? [],
      answer: options.answer ?? (options.isCorrect ? '正确答案' : '错误答案'),
    },
  });

  expect(response.status(), `提交作答失败：${await response.text()}`).toBe(200);

  const body = (await response.json()) as {
    data: { mastery: { knowledgePointId: string; level: string; score: number | null; confidence: number; evidenceCount: number }[] };
  };
  return body.data;
}

/** 读取题目详情 */
export async function getQuestionDetail(context: APIRequestContext, questionId: string) {
  const response = await context.get(`/api/questions/${questionId}`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    data: {
      question: {
        id: string;
        stem: string;
        knowledgePoints: { id: string; name: string }[];
        mistake: { id: string; status: string; nextReviewAt: string | null } | null;
      };
      attempts: { id: string; isCorrect: boolean; context: string }[];
      reviewHistory: { result: string }[];
    };
  };
  return body.data;
}

/** 通过页面完成登录（走真实表单，而不是直接塞 Cookie） */
export async function loginViaForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  // 未完成建档的新账号会被先带去 /onboarding，两种情况都算登录成功
  await expect(page).toHaveURL(/\/dashboard|\/onboarding/, { timeout: 30_000 });
}

/**
 * 等待页面主内容渲染完成，并**等到可交互**再交给用例。
 *
 * 为什么不能只用 domcontentloaded：
 *   本站是客户端组件驱动的界面。`domcontentloaded` 只保证 HTML 到了，
 *   此时 React 可能还没 hydration 完成 —— 这时 fill() 发出的 input 事件
 *   会被丢掉（表现：输入框看着填了、React 状态却是空的，按钮仍禁用）。
 *   在冷启动的 dev server 上（首次访问某路由需要编译）这个窗口特别明显。
 *
 * `networkidle` 是个足够好的"资源已就绪"信号；即使因为长连接导致它超时，
 * 也不应让用例直接失败，所以超时被吞掉。
 */
export async function gotoApp(page: Page, pathname: string): Promise<void> {
  // 'load' 比 domcontentloaded 更接近可交互状态
  await page.goto(pathname, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.locator('#main').waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * 往受控输入框里填内容，并确认 **React 真的收到了**。
 *
 * 受控组件在 hydration 之前会丢事件，所以"填一次就断言"必然间歇性失败。
 * 这里用 toPass 重试，直到 UI 反映出新值（由调用方给出的校验函数判断）。
 */
export async function fillControlledInput(
  locator: import('@playwright/test').Locator,
  value: string,
  verify: () => Promise<void>,
  timeout = 30_000,
): Promise<void> {
  await expect(async () => {
    await locator.fill(value);
    await verify();
  }).toPass({ timeout });
}
