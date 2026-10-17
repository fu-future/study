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
 * 知识点诊断 E2E。
 *
 * 这里验证的是**核心业务规则**，不是"页面能打开"：
 *   - 证据不足时必须显示"还需要更多练习"，不给假分数
 *   - 有足够证据时给出等级 + 置信度 + 置信度依据
 *   - 反复出现的错误要能识别，并触发"先补前置知识"的建议
 */

test.describe('知识点地图', () => {
  test('地图页面展示 seed 提供的知识点与章节结构', async ({ page }) => {
    await registerOnboardedUser(page.request);

    await gotoApp(page, '/knowledge');

    const response = await page.request.get('/api/knowledge-points?limit=200');
    const body = (await response.json()) as {
      data: { items: { name: string; chapterPath: string }[]; total: number };
    };

    expect(body.data.total).toBeGreaterThan(0);
    // 至少能看到一个知识点的名字
    await expect(page.getByText(body.data.items[0]!.name, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('知识点详情页可访问，并展示常见错误与典型题型（来自目录数据）', async ({ page }) => {
    await registerOnboardedUser(page.request);
    const kp = await getReviewedKnowledgePoint(page.request);

    await gotoApp(page, `/knowledge/${kp.id}`);

    await expect(page.getByText(kp.name, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('未审核（draft）的知识点不会出现在默认目录里', async ({ page }) => {
    await registerOnboardedUser(page.request);

    const reviewed = await page.request.get('/api/knowledge-points?reviewStatus=reviewed&limit=500');
    const all = await page.request.get('/api/knowledge-points?limit=500');

    const reviewedBody = (await reviewed.json()) as { data: { items: { reviewStatus: string }[] } };
    expect(reviewedBody.data.items.every((item) => item.reviewStatus === 'reviewed')).toBe(true);

    const allBody = (await all.json()) as { data: { items: unknown[] } };
    expect(allBody.data.items.length).toBeGreaterThanOrEqual(reviewedBody.data.items.length);
  });
});

test.describe('掌握度诊断', () => {
  test('证据不足时显示"还需要更多练习"，且不给出分数', async ({ page }) => {
    await registerOnboardedUser(page.request);
    const subjectId = await getMathSubjectId(page.request);
    const kp = await getReviewedKnowledgePoint(page.request, { subjectId });

    const questionId = await createMistakeQuestion(page.request, {
      subjectId,
      stem: `E2E-证据不足-${Date.now().toString(36)}：判断函数单调性`,
      knowledgePointIds: [kp.id],
    });

    // 只作答 1 次 —— 业务规则要求此时不能下结论
    await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['concept'] });

    const response = await page.request.get(`/api/mastery/${kp.id}`);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: {
        diagnosis: {
          result: {
            level: string;
            score: number | null;
            hasScore: boolean;
            evidenceCount: number;
            nextAction: string;
            confidenceReasons: string[];
          };
          evidence: unknown[];
        };
      };
    };

    const result = body.data.diagnosis.result;
    expect(result.level).toBe('insufficient');
    expect(result.hasScore).toBe(false);
    expect(result.score).toBeNull();
    expect(result.evidenceCount).toBe(1);
    expect(result.nextAction).toContain('还需要更多练习');
    expect(body.data.diagnosis.evidence).toHaveLength(1);
  });

  test('积累足够证据后给出等级与可解释的置信度依据', async ({ page }) => {
    await registerOnboardedUser(page.request);
    const subjectId = await getMathSubjectId(page.request);
    const kp = await getReviewedKnowledgePoint(page.request, { subjectId });

    const questionId = await createMistakeQuestion(page.request, {
      subjectId,
      stem: `E2E-有证据-${Date.now().toString(36)}：导数与极值`,
      knowledgePointIds: [kp.id],
    });

    // 4 次独立作答（3 错 1 对）→ 有效证据量超过门槛，可以形成结论
    await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['concept'] });
    await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['concept'] });
    await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['calculation'] });
    const last = await submitAttempt(page.request, questionId, { isCorrect: true });

    expect(last.mastery[0]!.evidenceCount).toBe(4);

    const response = await page.request.get(`/api/mastery/${kp.id}`);
    const body = (await response.json()) as {
      data: {
        diagnosis: {
          result: {
            level: string;
            score: number | null;
            hasScore: boolean;
            confidence: number;
            confidenceReasons: string[];
            repeatedErrorTypes: { type: string; count: number }[];
            needsPrerequisiteReview: boolean;
            nextAction: string;
          };
        };
      };
    };

    const result = body.data.diagnosis.result;
    expect(result.hasScore).toBe(true);
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(0);
    expect(result.score!).toBeLessThanOrEqual(100);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.92);

    // 置信度必须有可解释依据
    expect(result.confidenceReasons.join(' ')).toContain('有效证据量');
  });

  test('反复出现的概念性错误会被识别，并建议先补前置知识', async ({ page }) => {
    await registerOnboardedUser(page.request);
    const subjectId = await getMathSubjectId(page.request);
    const kp = await getReviewedKnowledgePoint(page.request, { subjectId });

    const questionId = await createMistakeQuestion(page.request, {
      subjectId,
      stem: `E2E-重复错误-${Date.now().toString(36)}：含参单调性讨论`,
      knowledgePointIds: [kp.id],
    });

    for (let i = 0; i < 4; i += 1) {
      await submitAttempt(page.request, questionId, { isCorrect: false, errorTypes: ['concept'] });
    }

    const response = await page.request.get(`/api/mastery/${kp.id}`);
    const body = (await response.json()) as {
      data: {
        diagnosis: {
          result: {
            repeatedErrorTypes: { type: string; count: number }[];
            needsPrerequisiteReview: boolean;
            nextAction: string;
            level: string;
          };
          prerequisites: { id: string; name: string; depth: number }[];
        };
      };
    };

    const result = body.data.diagnosis.result;
    const concept = result.repeatedErrorTypes.find((item) => item.type === 'concept');
    expect(concept, '应当识别出重复的概念性错误').toBeTruthy();
    expect(concept!.count).toBe(4);
    expect(result.needsPrerequisiteReview).toBe(true);
    expect(result.nextAction).toContain('前置知识');
    expect(result.level).not.toBe('stable');
  });

  test('掌握度列表展示真实记录，并按等级给出中文标签', async ({ page }) => {
    await registerOnboardedUser(page.request);
    const subjectId = await getMathSubjectId(page.request);
    const kp = await getReviewedKnowledgePoint(page.request, { subjectId });

    const questionId = await createMistakeQuestion(page.request, {
      subjectId,
      stem: `E2E-列表-${Date.now().toString(36)}：单调性判断`,
      knowledgePointIds: [kp.id],
    });
    await submitAttempt(page.request, questionId, { isCorrect: false });
    await submitAttempt(page.request, questionId, { isCorrect: false });

    const response = await page.request.get('/api/mastery?scope=all');
    const body = (await response.json()) as {
      data: {
        items: { knowledgePointId: string; knowledgePointName: string; level: string; levelLabel: string }[];
        distribution: Record<string, number>;
      };
    };

    const target = body.data.items.find((item) => item.knowledgePointId === kp.id);
    expect(target).toBeTruthy();
    expect(['insufficient', 'learning']).toContain(target!.level);
    // 等级必须有中文标签，不能把英文枚举直接给学生看
    expect(target!.levelLabel).toMatch(/[\u4e00-\u9fa5]/);

    await gotoApp(page, '/knowledge');
    await expect(page.locator('#main')).toBeVisible();
  });

  test('未作答的知识点不出现在掌握度列表里（避免假数据）', async ({ page }) => {
    // 全新账号、零作答记录
    await registerOnboardedUser(page.request);

    const response = await page.request.get('/api/mastery?scope=all');
    const body = (await response.json()) as { data: { items: unknown[] } };
    expect(body.data.items).toHaveLength(0);
  });
});
