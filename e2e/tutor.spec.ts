import { expect, test } from '@playwright/test';
import { fillControlledInput, gotoApp, registerOnboardedUser } from './helpers';

/**
 * AI 答疑 E2E（Mock 模式）。
 *
 * 这里验证的是**流式链路本身**：
 *   浏览器 → SSE 流 → 服务端 → Provider 抽象层 → Mock Provider → 逐块回传 → 落库。
 *
 * ⚠️ 重要说明：Mock Provider 刻意**不生成**看起来像真答案的解题内容，
 *    它只输出明确标注的占位说明。因此本用例断言的是"链路通、标注清楚、记录持久化"，
 *    **不是**"回答正确"。真实模型的答案质量需要配置 API Key 后单独验收（见 docs/AI_PROVIDER.md）。
 */

test.describe('AI 答疑（Mock 流式）', () => {
  test('发送问题后能收到流式回复，且明确标注为 Mock 内容', async ({ page }) => {
    await registerOnboardedUser(page.request);

    await gotoApp(page, '/tutor');

    const input = page.locator('#tutor-input');
    await expect(input).toBeVisible({ timeout: 30_000 });

    const counter = page.getByText(/Enter 发送/);
    await fillControlledInput(input, '导数的几何意义是什么？我总把平均变化率当成瞬时变化率。', async () => {
      await expect(counter).toContainText(/[1-9]\d*\/4000/, { timeout: 2_000 });
    });

    await page.getByRole('button', { name: '发送', exact: true }).click();

    // Mock Provider 的输出里带有明确的"演示/未接入真实模型"标注
    await expect(page.getByText(/Mock 模式/).first()).toBeVisible({ timeout: 40_000 });

    // 学生的提问也要出现在对话区
    await expect(page.getByText('导数的几何意义', { exact: false }).first()).toBeVisible();
  });

  test('对话会被持久化：刷新页面后仍能在会话列表里看到', async ({ page }) => {
    await registerOnboardedUser(page.request);

    await gotoApp(page, '/tutor');
    const questionText = '为什么函数在某点可导一定连续，但连续不一定可导？';
    const composer = page.locator('#tutor-input');
    await fillControlledInput(composer, questionText, async () => {
      await expect(page.getByText(/Enter 发送/)).toContainText(/[1-9]\d*\/4000/, { timeout: 2_000 });
    });
    await page.getByRole('button', { name: '发送', exact: true }).click();

    await expect(page.getByText(/Mock 模式/).first()).toBeVisible({ timeout: 40_000 });

    // 接口层面确认已落库（用户消息在生成前就已保存，AI 回复在流结束时保存）
    await expect
      .poll(
        async () => {
          const response = await page.request.get('/api/conversations');
          const body = (await response.json()) as {
            data: { items: { id: string; title: string; messageCount: number }[] };
          };
          return body.data.items.reduce((sum, item) => sum + item.messageCount, 0);
        },
        { timeout: 30_000, message: '对话应当被持久化' },
      )
      .toBeGreaterThanOrEqual(2); // 至少 1 条提问 + 1 条回复

    // 刷新后等待页面为渲染会话列表而发起的 /api/conversations 返回，
    // 再断言内容 —— 避免在 hydration 完成前就断言（实测过这个时序坑）
    const conversationsLoaded = page.waitForResponse(
      (response) => response.url().includes('/api/conversations') && response.status() === 200,
      { timeout: 30_000 },
    );
    await page.reload();
    await expect(page.locator('#main')).toBeVisible({ timeout: 30_000 });
    await conversationsLoaded;

    await expect(page.getByText('为什么函数在某点可导', { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('四种答疑模式都可以切换（默认引导模式）', async ({ page }) => {
    await registerOnboardedUser(page.request);
    await gotoApp(page, '/tutor');

    for (const label of ['引导模式', '详细讲解模式', '考试复盘模式', '快速答疑模式']) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    }
  });

  test('空输入无法发送（表单校验生效）', async ({ page }) => {
    await registerOnboardedUser(page.request);
    await gotoApp(page, '/tutor');

    // 用稳定的 id 定位，而不是 textarea 的 DOM 顺序 ——
    // 页面里以后还会加别的输入框（例如题目录入对话框），顺序不再可靠。
    const input = page.locator('#tutor-input');
    await expect(input).toBeVisible({ timeout: 30_000 });

    const sendButton = page.getByRole('button', { name: '发送', exact: true });
    // 计数器所在的 <p> 整段是「Enter 发送 · Shift + Enter 换行 · 4/4000」，
    // 所以必须用 toContainText，而不是精确匹配整段文本
    const counter = page.getByText(/Enter 发送/);

    await expect(sendButton).toBeDisabled();

    // 等 React 真正收到输入（hydration 之前的事件会被丢掉）
    await fillControlledInput(
      input,
      '测试内容',
      async () => {
        await expect(counter).toContainText('4/4000', { timeout: 2_000 });
      },
    );

    await expect(sendButton).toBeEnabled();

    // 清空后应重新变回禁用
    await fillControlledInput(
      input,
      '',
      async () => {
        await expect(counter).toContainText('0/4000', { timeout: 2_000 });
      },
    );
    await expect(sendButton).toBeDisabled();
  });

  test('未登录访问答疑接口返回 401', async ({ page }) => {
    const response = await page.request.post('/api/chat', {
      data: { message: '测试', mode: 'guided' },
    });
    expect(response.status()).toBe(401);
  });

  test('超长问题被拒绝（输入长度限制生效）', async ({ page }) => {
    await registerOnboardedUser(page.request);

    const response = await page.request.post('/api/chat', {
      data: { message: 'a'.repeat(4100), mode: 'guided' },
    });

    // 校验层拦截，不是让超长内容打到上游模型
    expect(response.status()).toBe(400);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
