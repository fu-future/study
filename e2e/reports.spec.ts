import { expect, test } from '@playwright/test';
import {
  createMistakeQuestion,
  getMathSubjectId,
  getReviewedKnowledgePoint,
  gotoApp,
  registerOnboardedUser,
  submitAttempt,
} from './helpers';

/**
 * 学习报告 E2E。
 *
 * 关键业务断言（需求 4.8）：
 *   - 四个指标必须**分开**呈现：学习时间 / 任务完成率 / 练习正确率 / 知识掌握估计
 *   - 没有数据时显示空状态，而不是显示 0%（0% 会被误解为"做了但全错"）
 *   - 必须展示「诊断的证据与不确定性」，说明掌握度是估计值
 *   - 所有统计来自真实记录
 */

test.describe('学习报告', () => {
  test('新账号的报告显示空状态而不是 0%', async ({ page }) => {
    await registerOnboardedUser(page.request);

    await gotoApp(page, '/reports');

    // 无数据时页面**不渲染**四个指标卡片，而是显示空状态 ——
    // 这是刻意的：宁可少显示，也不给出一堆 0 让人误以为"做了但全错"。
    await expect(page.getByText('这一周还没有足够的数据', { exact: false }).first()).toBeVisible({ timeout: 30_000 });

    // 无数据：接口层面确认是 null 而不是 0
    const response = await page.request.get('/api/reports/weekly?weekOffset=0');
    const body = (await response.json()) as {
      data: {
        practice: { total: number; accuracy: number | null };
        tasks: { total: number; completionRate: number | null };
        hasEnoughData: boolean;
      };
    };

    expect(body.data.practice.total).toBe(0);
    expect(body.data.practice.accuracy).toBeNull();
    expect(body.data.tasks.completionRate).toBeNull();
    expect(body.data.hasEnoughData).toBe(false);

    // 页面上不应出现 "0%" 这种会被误解的数字
    const mainText = (await page.locator('#main').innerText()).replace(/\s+/g, ' ');
    expect(mainText).not.toContain('0%');
  });

  test('有真实记录时显示统计值，并区分四个指标', async ({ page }) => {
    await registerOnboardedUser(page.request);
    const subjectId = await getMathSubjectId(page.request);
    const kp = await getReviewedKnowledgePoint(page.request, { subjectId });

    const questionId = await createMistakeQuestion(page.request, {
      subjectId,
      stem: `E2E-报告-${Date.now().toString(36)}：导数的应用`,
      knowledgePointIds: [kp.id],
    });

    await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['calculation'] });
    await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['calculation'] });
    await submitAttempt(page.request, questionId, { isCorrect: true });

    const response = await page.request.get('/api/reports/weekly?weekOffset=0');
    const body = (await response.json()) as {
      data: {
        practice: { total: number; correct: number; accuracy: number | null };
        tasks: { total: number; completionRate: number | null };
        studyTime: { totalMinutes: number; sessions: number };
        mastery: { distribution: Record<string, number>; needsWork: unknown[] };
        repeatedErrors: { type: string; label: string; count: number }[];
        evidenceNotes: string[];
        suggestions: string[];
        hasEnoughData: boolean;
      };
    };

    const data = body.data;

    // 练习正确率来自真实作答：3 题 1 对 ≈ 33%
    expect(data.practice.total).toBe(3);
    expect(data.practice.correct).toBe(1);
    expect(data.practice.accuracy).toBeCloseTo(1 / 3, 2);

    // 学习时间与任务完成率是**另外两个**指标，不能与正确率混为一谈
    expect(data.studyTime).toBeDefined();
    expect(data.tasks).toBeDefined();
    expect(data.mastery.distribution).toBeDefined();
    expect(data.hasEnoughData).toBe(true);

    // 重复错误类型应被统计出来（同一类错误出现 2 次）
    const calculation = data.repeatedErrors.find((item) => item.type === 'calculation');
    expect(calculation).toBeTruthy();
    expect(calculation!.count).toBe(2);
    expect(calculation!.label).toMatch(/[\u4e00-\u9fa5]/);

    // 证据与不确定性说明必须存在
    expect(data.evidenceNotes.length).toBeGreaterThan(0);
    expect(data.evidenceNotes.join(' ')).toContain('估计');

    // 建议要有，且不能是羞辱式/焦虑式表达
    expect(data.suggestions.length).toBeGreaterThan(0);
    const suggestionText = data.suggestions.join(' ');
    expect(suggestionText).not.toMatch(/落后|太差|不合格|再不/);

    await gotoApp(page, '/reports');
    // 有数据时四个指标必须**分开**成卡片呈现
    await expect(page.getByText('学习时间', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('任务完成率', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('练习正确率', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('知识掌握估计', { exact: true }).first()).toBeVisible();
  });

  test('可以查看上一周的报告（区间不同）', async ({ page }) => {
    await registerOnboardedUser(page.request);

    const current = await page.request.get('/api/reports/weekly?weekOffset=0');
    const previous = await page.request.get('/api/reports/weekly?weekOffset=1');

    expect(current.status()).toBe(200);
    expect(previous.status()).toBe(200);

    const currentBody = (await current.json()) as { data: { range: { from: string } } };
    const previousBody = (await previous.json()) as { data: { range: { from: string } } };

    expect(new Date(previousBody.data.range.from).getTime()).toBeLessThan(
      new Date(currentBody.data.range.from).getTime(),
    );
  });

  test('报告区间跨越 7 天，且周一起算', async ({ page }) => {
    await registerOnboardedUser(page.request);

    const response = await page.request.get('/api/reports/weekly?weekOffset=0');
    const body = (await response.json()) as { data: { range: { from: string; to: string } } };

    const from = new Date(body.data.range.from);
    const to = new Date(body.data.range.to);

    // 区间长度 7 天
    expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(7);
    // 起始日是周一（UTC）
    expect(from.getUTCDay()).toBe(1);
  });

  test('周报接口需要登录', async ({ page }) => {
    const response = await page.request.get('/api/reports/weekly');
    expect(response.status()).toBe(401);
  });
});
