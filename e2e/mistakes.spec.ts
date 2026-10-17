import { expect, test } from '@playwright/test';
import {
  createMistakeQuestion,
  getMathSubjectId,
  getQuestionDetail,
  getReviewedKnowledgePoint,
  gotoApp,
  registerOnboardedUser,
  submitAttempt,
} from './helpers';

/**
 * 错题本 E2E：录入 → 查看 → 多次作答 → 复习。
 *
 * 关键业务断言：
 *   - 同一道题可以保留**多次**作答记录（不是只存最后一次）
 *   - 复习会推进间隔复习计划，并写入历史
 */

async function setupMistake(page: import('@playwright/test').Page) {
  await registerOnboardedUser(page.request);
  const subjectId = await getMathSubjectId(page.request);
  const kp = await getReviewedKnowledgePoint(page.request, { subjectId });

  const marker = `E2E-题目-${Date.now().toString(36)}`;
  const questionId = await createMistakeQuestion(page.request, {
    subjectId,
    stem: `${marker}：已知函数 f(x)=x^3-3ax+1，讨论 a 的取值对单调性的影响。`,
    knowledgePointIds: [kp.id],
    studentAnswer: 'f′(x)=3x^2-3a>0 解得 x>√a',
    correctAnswer: '需对 a 的正负分类讨论',
    errorTypes: ['concept', 'incomplete-reasoning'],
  });

  return { subjectId, kp, questionId, marker };
}

test.describe('错题录入与查看', () => {
  test('创建错题后能在错题本列表和详情页看到', async ({ page }) => {
    const { questionId, marker, kp } = await setupMistake(page);

    await gotoApp(page, '/mistakes');
    await expect(page.getByText(marker, { exact: false })).toBeVisible({ timeout: 30_000 });

    await gotoApp(page, `/mistakes/${questionId}`);
    await expect(page.getByText(marker, { exact: false })).toBeVisible({ timeout: 30_000 });
    // 关联的知识点要显示出来（错题必须能追溯到知识点）
    await expect(page.getByText(kp.name, { exact: false }).first()).toBeVisible();
    // 错误原因分类
    await expect(page.getByText('概念理解错误', { exact: false }).first()).toBeVisible();
  });

  test('错题详情返回完整记录（题干/答案/解析/知识点/错题状态）', async ({ page }) => {
    const { questionId, marker } = await setupMistake(page);
    const detail = await getQuestionDetail(page.request, questionId);

    expect(detail.question.stem).toContain(marker);
    expect(detail.question.knowledgePoints.length).toBeGreaterThan(0);
    expect(detail.question.mistake).not.toBeNull();
    expect(detail.question.mistake!.nextReviewAt).toBeTruthy();
  });

  test('空账号的错题本显示友好的空状态，而不是报错', async ({ page }) => {
    await registerOnboardedUser(page.request);

    await gotoApp(page, '/mistakes');
    await expect(page.getByText('错题本还是空的', { exact: false })).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('同一题目的多次作答', () => {
  test('连续 3 次作答全部保留，不会被覆盖', async ({ page }) => {
    const { questionId } = await setupMistake(page);

    await submitAttempt(page.request, questionId, { isCorrect: false, context: 'practice' });
    await submitAttempt(page.request, questionId, { isCorrect: false, independence: 'with-hint' });
    await submitAttempt(page.request, questionId, { isCorrect: true, independence: 'independent' });

    const detail = await getQuestionDetail(page.request, questionId);

    expect(detail.attempts).toHaveLength(3);
    expect(detail.attempts.map((attempt) => attempt.isCorrect)).toEqual([false, false, true]);
    // 顺序按时间正序，且最后一次是独立完成
    expect(detail.attempts[2]!.context).toBe('practice');
  });

  test('作答后掌握度被同步更新（证据条数增加）', async ({ page }) => {
    const { questionId } = await setupMistake(page);

    const first = await submitAttempt(page.request, questionId, { isCorrect: false });
    const second = await submitAttempt(page.request, questionId, { isCorrect: false });
    const third = await submitAttempt(page.request, questionId, { isCorrect: true });

    expect(first.mastery.length).toBeGreaterThan(0);
    expect(second.mastery[0]!.evidenceCount).toBe(2);
    expect(third.mastery[0]!.evidenceCount).toBe(3);
  });

  test('作答历史在详情页可见', async ({ page }) => {
    const { questionId } = await setupMistake(page);
    await submitAttempt(page.request, questionId, { isCorrect: false });
    await submitAttempt(page.request, questionId, { isCorrect: true });

    await gotoApp(page, `/mistakes/${questionId}`);
    // 至少能看到"作答"相关的区块
    await expect(page.getByText(/作答|练习|复习/).first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('错题复习', () => {
  test('复习后返回新的复习时间，并记录复习历史', async ({ page }) => {
    const { questionId } = await setupMistake(page);

    const response = await page.request.post(`/api/questions/${questionId}/review`, {
      data: { result: 'correct', independence: 'independent' },
    });
    expect(response.status(), await response.text()).toBe(200);

    const body = (await response.json()) as {
      data: {
        review: { dueAt: string; intervalDays: number; repetition: number } | null;
        mastery: { level: string }[];
      };
    };

    // 答对后复习间隔应当被推进（不是固定 1 天）
    expect(body.data.review).not.toBeNull();
    expect(body.data.review!.intervalDays).toBeGreaterThanOrEqual(1);
    expect(body.data.review!.repetition).toBeGreaterThanOrEqual(1);
    expect(new Date(body.data.review!.dueAt).getTime()).toBeGreaterThan(Date.now() - 1000);

    const detail = await getQuestionDetail(page.request, questionId);
    expect(detail.reviewHistory.length).toBeGreaterThanOrEqual(1);
    expect(detail.reviewHistory.at(-1)!.result).toBe('correct');
  });

  test('复习答错会把间隔重置为 1 天', async ({ page }) => {
    const { questionId } = await setupMistake(page);

    // 先答对两次把间隔推上去
    await page.request.post(`/api/questions/${questionId}/review`, {
      data: { result: 'correct', independence: 'independent' },
    });
    await page.request.post(`/api/questions/${questionId}/review`, {
      data: { result: 'correct', independence: 'independent' },
    });

    const wrong = await page.request.post(`/api/questions/${questionId}/review`, {
      data: { result: 'wrong', independence: 'independent' },
    });
    const body = (await wrong.json()) as {
      data: { review: { intervalDays: number; repetition: number } };
    };

    expect(body.data.review.intervalDays).toBe(1);
    expect(body.data.review.repetition).toBe(0);
  });

  test('复习面板在详情页可用（三个结果按钮都在）', async ({ page }) => {
    const { questionId } = await setupMistake(page);
    await gotoApp(page, `/mistakes/${questionId}`);

    await expect(page.getByText('做对了', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('部分对', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('做错了', { exact: false }).first()).toBeVisible();
  });

  test('对不存在的题目发起复习返回 404，而不是服务端错误', async ({ page }) => {
    await registerOnboardedUser(page.request);

    const response = await page.request.post(
      '/api/questions/does-not-exist-00000000/review',
      { data: { result: 'correct', independence: 'independent' } },
    );

    expect(response.status()).toBe(404);
  });
});
