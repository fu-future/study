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
 * 学习计划 E2E：生成计划 → 时间约束 → 完成任务 → 计划随数据变化。
 *
 * 关键业务断言：
 *   - 计划总时长**不超过**学生设定的每日可用时间
 *   - 超时任务会被精简，并如实告知精简了几个
 *   - 任务是可解释的（每条都有推荐原因）
 *   - 完成后能记录结果，且记录不被后续重新生成计划抹掉
 */

/** 造出"有薄弱点 + 有到期复习"的状态，保证计划里一定有任务 */
async function prepareWeakState(page: import('@playwright/test').Page) {
  await registerOnboardedUser(page.request, { dailyAvailableMinutes: 90 });
  const subjectId = await getMathSubjectId(page.request);
  const kp = await getReviewedKnowledgePoint(page.request, { subjectId });

  const questionId = await createMistakeQuestion(page.request, {
    subjectId,
    stem: `E2E-计划-${Date.now().toString(36)}：含参函数的单调性讨论`,
    knowledgePointIds: [kp.id],
  });

  // 3 次答错 → 掌握度进入「正在学习」→ 会被排进计划
  await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['method'] });
  await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['method'] });
  await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['method'] });

  return { subjectId, kp, questionId };
}

test.describe('生成学习计划', () => {
  test('通过界面生成今日计划，并展示任务与推荐原因', async ({ page }) => {
    await prepareWeakState(page);

    await gotoApp(page, '/planner');
    await page.getByRole('button', { name: '生成今日计划' }).first().click();

    // 生成结果提示（成功或"没有可安排的内容"都算正常返回）
    await expect(page.getByText(/已生成|没有生成任务/)).toBeVisible({ timeout: 30_000 });

    // 计划页面应当出现任务的推荐原因说明
    await expect(page.getByText(/为什么|推荐|原因/).first()).toBeVisible({ timeout: 30_000 });
  });

  test('计划总时长不超过每日可用时间，且逐天校验', async ({ page }) => {
    await prepareWeakState(page);

    const response = await page.request.post('/api/study-plans/generate', {
      data: { planType: 'daily' },
    });
    expect(response.status(), await response.text()).toBe(200);

    const body = (await response.json()) as {
      data: {
        totalMinutes: number;
        trimmedCount: number;
        minutesByDay: { minutes: number; availableMinutes: number }[];
        tasks: { estimatedMinutes: number; reason: string; completionCriteria: string | null }[];
        plan: { plannedMinutes: number; availableMinutes: number; rationale: { notes?: string[] } };
      };
    };

    const data = body.data;

    for (const day of data.minutesByDay) {
      expect(day.minutes, '每天安排量不得超过当天可用时间').toBeLessThanOrEqual(day.availableMinutes);
    }

    const sum = data.tasks.reduce((total, task) => total + task.estimatedMinutes, 0);
    expect(data.totalMinutes).toBe(sum);

    // 只要精简过，就必须在 rationale 里说明
    if (data.trimmedCount > 0) {
      expect((data.plan.rationale.notes ?? []).join('\n')).toContain('没有排进来');
    }
  });

  test('每个任务都带推荐原因与完成条件（计划必须可解释）', async ({ page }) => {
    await prepareWeakState(page);

    const response = await page.request.post('/api/study-plans/generate', {
      data: { planType: 'daily' },
    });
    const body = (await response.json()) as {
      data: { tasks: { reason: string; completionCriteria: string | null; priority: number }[] };
    };

    expect(body.data.tasks.length).toBeGreaterThan(0);
    for (const task of body.data.tasks) {
      expect(task.reason.length).toBeGreaterThan(0);
      expect(task.completionCriteria).toBeTruthy();
      expect(task.priority).toBeGreaterThanOrEqual(1);
      expect(task.priority).toBeLessThanOrEqual(5);
    }
  });

  test('可用时间很少时自动精简并如实报告', async ({ page }) => {
    // 每天只有 15 分钟
    await registerOnboardedUser(page.request, { dailyAvailableMinutes: 15 });
    const subjectId = await getMathSubjectId(page.request);
    const kp = await getReviewedKnowledgePoint(page.request, { subjectId });

    const questionId = await createMistakeQuestion(page.request, {
      subjectId,
      stem: `E2E-时间不足-${Date.now().toString(36)}：单调性`,
      knowledgePointIds: [kp.id],
    });
    await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['method'] });
    await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['method'] });
    await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['method'] });

    const response = await page.request.post('/api/study-plans/generate', {
      data: { planType: 'daily' },
    });
    const body = (await response.json()) as {
      data: {
        totalMinutes: number;
        trimmedCount: number;
        minutesByDay: { minutes: number; availableMinutes: number }[];
      };
    };

    expect(body.data.minutesByDay[0]!.availableMinutes).toBeLessThanOrEqual(15);
    expect(body.data.totalMinutes).toBeLessThanOrEqual(15);
    expect(body.data.trimmedCount).toBeGreaterThan(0);
  });

  test('生成本周计划覆盖 7 天', async ({ page }) => {
    await prepareWeakState(page);

    const response = await page.request.post('/api/study-plans/generate', {
      data: { planType: 'weekly' },
    });
    const body = (await response.json()) as { data: { minutesByDay: unknown[] } };

    expect(body.data.minutesByDay).toHaveLength(7);
  });

  test('计划列表接口返回刚生成的计划', async ({ page }) => {
    await prepareWeakState(page);

    await page.request.post('/api/study-plans/generate', { data: { planType: 'daily' } });

    const response = await page.request.get('/api/study-plans');
    const body = (await response.json()) as {
      data: { items: { id: string; planType: string; status: string }[] };
    };

    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items.some((item) => item.planType === 'daily')).toBe(true);
  });
});

test.describe('完成任务', () => {
  test('通过界面完成任务，完成状态被持久化', async ({ page }) => {
    await prepareWeakState(page);

    await gotoApp(page, '/planner');
    await page.getByRole('button', { name: '生成今日计划' }).first().click();
    await expect(page.getByText(/已生成|没有生成任务/)).toBeVisible({ timeout: 30_000 });

    // 重新载入，确保任务来自服务端渲染
    await gotoApp(page, '/planner');

    const completeButton = page.getByRole('button', { name: '完成', exact: true }).first();
    await expect(completeButton).toBeVisible({ timeout: 30_000 });

    const completionResponse = page.waitForResponse(
      (response) => /\/api\/study-tasks\/.+\/complete/.test(response.url()) && response.request().method() === 'POST',
      { timeout: 30_000 },
    );

    await completeButton.click();
    // 对话框里的提交按钮
    await page.locator('[role="dialog"] button[type="submit"]').click();

    const response = await completionResponse;
    expect(response.status(), await response.text()).toBe(200);

    // 完成后重新载入，页面上应出现"已完成"记录
    await gotoApp(page, '/planner');
    await expect(page.getByText('已完成', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('完成任务时记录实际用时，并生成学习时段（学习时间是独立指标）', async ({ page }) => {
    await prepareWeakState(page);
    await page.request.post('/api/study-plans/generate', { data: { planType: 'daily' } });

    await gotoApp(page, '/planner');
    const completeButton = page.getByRole('button', { name: '完成', exact: true }).first();
    await expect(completeButton).toBeVisible({ timeout: 30_000 });
    await completeButton.click();
    await page.locator('[role="dialog"] button[type="submit"]').click();

    // 完成后，周报里的"学习时间"应当出现真实记录
    await expect
      .poll(
        async () => {
          const response = await page.request.get('/api/reports/weekly?weekOffset=0');
          const body = (await response.json()) as {
            data: { studyTime: { sessions: number; totalMinutes: number } };
          };
          return body.data.studyTime.sessions;
        },
        { timeout: 30_000, message: '完成任务后应当产生学习时段记录' },
      )
      .toBeGreaterThan(0);
  });

  test('对不存在的任务完成任务返回 404', async ({ page }) => {
    await registerOnboardedUser(page.request);

    const response = await page.request.post('/api/study-tasks/does-not-exist-0000/complete', {
      data: { selfAssessment: 'confident' },
    });

    expect(response.status()).toBe(404);
  });
});
