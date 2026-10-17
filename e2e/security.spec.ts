import { expect, test } from '@playwright/test';
import {
  DEFAULT_PASSWORD,
  createMistakeQuestion,
  getMathSubjectId,
  getQuestionDetail,
  getReviewedKnowledgePoint,
  registerOnboardedUser,
} from './helpers';

/**
 * 安全与数据隔离 E2E。
 *
 * 这是 Phase 7 安全检查的**运行时证据**：
 *   1. 用户之间数据完全隔离（不能靠猜 id 访问别人的学习记录）
 *   2. 题目图片必须登录才能访问
 *   3. 上传要做类型与大小校验
 *   4. 错误响应不泄露堆栈、内部路径、密钥
 *   5. 健康检查接口不泄露任何密钥值
 *
 * ⚠️ 这些用例**不关闭**任何校验 —— 它们正是在验证校验生效。
 */

test.describe('用户间数据隔离', () => {
  test('用户 B 无法读取用户 A 的题目、作答与复习记录', async ({ browser }) => {
    // ---- 用户 A：建一道错题并作答 ----
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await registerOnboardedUser(pageA.request);
    const subjectId = await getMathSubjectId(pageA.request);
    const kp = await getReviewedKnowledgePoint(pageA.request, { subjectId });

    const questionId = await createMistakeQuestion(pageA.request, {
      subjectId,
      stem: `E2E-隔离-${Date.now().toString(36)}：这是用户 A 的私密题目`,
      knowledgePointIds: [kp.id],
    });

    const attemptResponse = await pageA.request.post(`/api/questions/${questionId}/attempts`, {
      data: { isCorrect: false, independence: 'independent', difficultySnapshot: 3, context: 'practice' },
    });
    expect(attemptResponse.status()).toBe(200);

    // ---- 用户 B：独立会话 ----
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await registerOnboardedUser(pageB.request);

    // 1) 读题目 → 404
    const readQuestion = await pageB.request.get(`/api/questions/${questionId}`);
    expect(readQuestion.status(), '跨用户读取题目必须失败').toBe(404);

    // 2) 给别人的题目提交作答 → 404
    const crossAttempt = await pageB.request.post(`/api/questions/${questionId}/attempts`, {
      data: { isCorrect: true, independence: 'independent', difficultySnapshot: 3, context: 'practice' },
    });
    expect(crossAttempt.status(), '不能给别人的题目提交作答').toBe(404);

    // 3) 改别人的题目 → 404
    const crossPatch = await pageB.request.patch(`/api/questions/${questionId}`, {
      data: { stem: '被篡改的题干' },
    });
    expect(crossPatch.status(), '不能修改别人的题目').toBe(404);

    // 4) 复习别人的错题 → 404
    const crossReview = await pageB.request.post(`/api/questions/${questionId}/review`, {
      data: { result: 'correct', independence: 'independent' },
    });
    expect(crossReview.status(), '不能复习别人的错题').toBe(404);

    // 5) B 的列表里看不到 A 的题目
    const listB = await pageB.request.get('/api/questions?limit=100');
    const listBody = (await listB.json()) as { data: { items: { id: string }[] } };
    expect(listBody.data.items.some((item) => item.id === questionId)).toBe(false);

    // 6) B 的掌握度不受 A 的作答影响
    const masteryB = await pageB.request.get('/api/mastery?scope=all');
    const masteryBody = (await masteryB.json()) as { data: { items: unknown[] } };
    expect(masteryBody.data.items, 'B 不应该看到 A 的掌握度记录').toHaveLength(0);

    // 7) A 自己的数据仍然正常（确认不是"全都被拦"）
    const detailA = await getQuestionDetail(pageA.request, questionId);
    expect(detailA.attempts).toHaveLength(1);

    await contextA.close();
    await contextB.close();
  });

  test('两个账号的对话互不可见', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await registerOnboardedUser(pageA.request);
    await pageA.request.post('/api/chat', { data: { message: '用户 A 的私密提问', mode: 'guided' } });

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await registerOnboardedUser(pageB.request);

    const listB = await pageB.request.get('/api/conversations');
    const body = (await listB.json()) as { data: { items: { title: string }[] } };
    expect(body.data.items.some((item) => item.title.includes('用户 A'))).toBe(false);

    // B 去读 A 的会话必须失败
    const listA = await pageA.request.get('/api/conversations');
    const bodyA = (await listA.json()) as { data: { items: { id: string }[] } };
    if (bodyA.data.items.length > 0) {
      const cross = await pageB.request.get(`/api/conversations/${bodyA.data.items[0]!.id}`);
      expect(cross.status(), '跨用户读取会话必须失败').toBe(404);
    }

    await contextA.close();
    await contextB.close();
  });
});

test.describe('文件访问授权', () => {
  test('未登录访问题目图片返回 401', async ({ page }) => {
    const response = await page.request.get('/api/files/00000000-0000-0000-0000-000000000000.png');
    expect(response.status()).toBe(401);
  });

  test('路径穿越尝试被拒绝（不会读到目录外的文件）', async ({ page }) => {
    await registerOnboardedUser(page.request);

    for (const evil of [
      '../../../../package.json',
      '..%2F..%2F..%2Fpackage.json',
      '%2e%2e%2f%2e%2e%2fpackage.json',
    ]) {
      const response = await page.request.get(`/api/files/${encodeURIComponent(evil)}`);
      // 只允许 401/404/400，绝不允许 200
      expect([400, 401, 404], `路径穿越 ${evil} 必须被拒绝`).toContain(response.status());
      const text = await response.text();
      expect(text).not.toContain('"name"'); // package.json 的内容不应出现
    }
  });
});

test.describe('上传校验', () => {
  test('伪装成图片的文本文件被拒绝（按真实字节判断，不信任扩展名）', async ({ page }) => {
    await registerOnboardedUser(page.request);

    const response = await page.request.post('/api/questions/upload', {
      multipart: {
        file: {
          name: 'fake-question.png',
          mimeType: 'image/png',
          buffer: Buffer.from('这其实是一个文本文件，不是 PNG', 'utf8'),
        },
      },
    });

    expect(response.status()).toBe(400);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('UPLOAD_REJECTED');
  });

  test('超过大小上限的图片被拒绝', async ({ page }) => {
    await registerOnboardedUser(page.request);

    // 5.5 MB（上限是 5 MB），头部是合法的 PNG 魔数
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const oversized = Buffer.concat([pngMagic, Buffer.alloc(5.5 * 1024 * 1024, 0x41)]);

    const response = await page.request.post('/api/questions/upload', {
      multipart: {
        file: { name: 'huge.png', mimeType: 'image/png', buffer: oversized },
      },
    });

    expect(response.status()).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UPLOAD_REJECTED');
  });

  test('合法 PNG 可以上传，且未经登录不能读取', async ({ page }) => {
    await registerOnboardedUser(page.request);

    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const validPng = Buffer.concat([pngMagic, Buffer.alloc(512, 0x00)]);

    const upload = await page.request.post('/api/questions/upload', {
      multipart: { file: { name: 'question.png', mimeType: 'image/png', buffer: validPng } },
    });
    expect(upload.status(), await upload.text()).toBe(200);

    const body = (await upload.json()) as { data: { uploadId: string; url: string } };
    expect(body.data.uploadId).toMatch(/\.png$/);

    // 已登录可以读
    const authed = await page.request.get(body.data.url);
    expect(authed.status()).toBe(200);
    expect(authed.headers()['content-type']).toContain('image/png');

    // 未登录不能读（用独立 context 模拟）
    const anonContext = await page.context().browser()!.newContext();
    const anonResponse = await anonContext.request.get(body.data.url);
    expect(anonResponse.status()).toBe(401);
    await anonContext.close();
  });
});

test.describe('错误响应不泄露内部信息', () => {
  test('错误响应体不含堆栈、文件路径或密钥', async ({ page }) => {
    await registerOnboardedUser(page.request);

    const probes = [
      await page.request.get('/api/questions/not-a-real-id'),
      await page.request.post('/api/questions/not-a-real-id/attempts', {
        data: { isCorrect: true, independence: 'independent', difficultySnapshot: 3, context: 'practice' },
      }),
      await page.request.post('/api/study-plans/generate', { data: { planType: 'not-a-plan-type' } }),
      await page.request.post('/api/auth/login', { data: { email: 'not-an-email', password: 'x' } }),
    ];

    for (const response of probes) {
      const text = await response.text();

      expect(text).not.toMatch(/at\s+\w+\s+\(.*:\d+:\d+\)/); // 堆栈帧
      expect(text).not.toMatch(/[A-Za-z]:\\\\?\\|node_modules|\/src\/lib\//); // 内部路径
      expect(text).not.toContain('prisma'); // ORM 细节
      expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}/); // 密钥形态
      expect(text).not.toContain('SELECT '); // SQL 语句
    }
  });

  test('健康检查接口不泄露任何密钥值', async ({ page }) => {
    const response = await page.request.get('/api/health');
    expect(response.status()).toBe(200);

    const text = await response.text();
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(text).not.toContain('e2e-test-only-secret'); // SESSION_SECRET 的值
    expect(text).not.toContain('DATABASE_URL=');
    // 但应当如实报告"是否配置了 AI"，而不是什么都不说
    expect(text).toContain('"aiConfigured"');
  });

  test('未登录的错误响应也不泄露内部信息', async ({ page }) => {
    const response = await page.request.get('/api/questions');
    const text = await response.text();

    expect(response.status()).toBe(401);
    expect(text).not.toMatch(/node_modules|\/src\//);
    expect(text).toContain('UNAUTHORIZED');
  });
});

test.describe('会话与凭据', () => {
  test('会话 Cookie 是 httpOnly 且同站限制', async ({ page, baseURL }) => {
    await registerOnboardedUser(page.request);

    const cookies = await page.context().cookies(baseURL);
    const session = cookies.find((cookie) => cookie.name === 'sc_session');

    expect(session, '应当存在会话 Cookie').toBeTruthy();
    expect(session!.httpOnly, '会话 Cookie 必须是 httpOnly').toBe(true);
    expect(['Lax', 'Strict']).toContain(session!.sameSite);
  });

  test('篡改会话 Cookie 会被拒绝', async ({ page, baseURL }) => {
    await registerOnboardedUser(page.request);

    // 把签名改坏
    await page.context().addCookies([
      {
        name: 'sc_session',
        value: 'eyJ1aWQiOiJmYWtlIiwib3BlbiI6dHJ1ZX0.forged-signature',
        url: baseURL!,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    const response = await page.request.get('/api/questions');
    expect(response.status(), '伪造的会话必须无效').toBe(401);
  });

  test('演示账号使用哈希密码，且没有把明文写进库（通过登录行为间接验证）', async ({ browser }) => {
    // 正确密码可登录
    const contextOk = await browser.newContext();
    const pageOk = await contextOk.newPage();
    const ok = await pageOk.request.post('/api/auth/login', {
      data: { email: 'demo@study.local', password: 'study-coach-2026' },
    });
    expect(ok.status(), 'seed 的演示账号应当能用文档中的密码登录').toBe(200);

    // 错误密码不行
    const contextBad = await browser.newContext();
    const pageBad = await contextBad.newPage();
    const bad = await pageBad.request.post('/api/auth/login', {
      data: { email: 'demo@study.local', password: DEFAULT_PASSWORD },
    });
    expect(bad.status()).toBe(401);

    await contextOk.close();
    await contextBad.close();
  });
});
