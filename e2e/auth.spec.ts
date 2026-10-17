import { expect, test } from '@playwright/test';
import {
  DEFAULT_PASSWORD,
  completeOnboarding,
  loginViaForm,
  registerOnboardedUser,
  registerTestUser,
} from './helpers';

/**
 * 认证与会话 E2E。
 *
 * 覆盖：登录、登出、未登录跳转、注册、错误凭据提示。
 * 注意：这里**不关闭**任何鉴权 —— 未授权访问必须被拦住，正是要验证的点。
 */

test.describe('未登录访问受保护页面', () => {
  const protectedPages = ['/dashboard', '/mistakes', '/knowledge', '/planner', '/reports', '/settings', '/tutor'];

  for (const pathname of protectedPages) {
    test(`${pathname} 会被重定向到登录页`, async ({ page }) => {
      await page.goto(pathname);

      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
      // 登录表单必须真的渲染出来，而不是空白
      await expect(page.locator('input[autocomplete="email"]')).toBeVisible();
    });
  }

  test('未登录调用写入接口返回 401', async ({ page }) => {
    const response = await page.request.patch('/api/profile', {
      data: { grade: '高二' },
    });

    expect(response.status()).toBe(401);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('未登录读取用户数据接口返回 401', async ({ page }) => {
    for (const pathname of ['/api/questions', '/api/mastery', '/api/conversations', '/api/reports/weekly']) {
      const response = await page.request.get(pathname);
      expect(response.status(), `${pathname} 应当要求登录`).toBe(401);
    }
  });
});

test.describe('注册', () => {
  test('通过表单注册后进入仪表盘，并完成首次建档', async ({ page }) => {
    const suffix = Date.now().toString(36);
    const email = `e2e-register-${suffix}@study.test`;

    await page.goto('/register');
    await page.locator('input[autocomplete="nickname"]').fill('测试同学');
    await page.locator('input[autocomplete="email"]').fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(DEFAULT_PASSWORD);
    await page.locator('form button[type="submit"]').click();

    // 新用户 first-run 会被引导到建档向导，或者直接进入仪表盘
    await page.waitForURL(/\/onboarding|\/dashboard/, { timeout: 30_000 });
    await expect(page.locator('#main')).toBeVisible();
  });

  test('重复邮箱注册返回冲突而不是成功', async ({ page }) => {
    const user = await registerTestUser(page.request);

    const again = await page.request.post('/api/auth/register', {
      data: { email: user.email, displayName: '重复注册', password: DEFAULT_PASSWORD },
    });

    expect(again.status()).toBe(409);
    const body = (await again.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
  });
});

test.describe('登录与登出', () => {
  test('正确的邮箱密码可以登录，登出后受保护页面再次被拦', async ({ page }) => {
    const user = await registerTestUser(page.request);
    // 先完成建档：否则登录后会被引导到 /onboarding，干扰后续断言
    await completeOnboarding(page.request);

    // 清掉注册时建立的会话，确保下面走的是真正的表单登录
    await page.context().clearCookies();

    await loginViaForm(page, user.email, user.password);

    // 登录后能进主要页面
    for (const pathname of ['/mistakes', '/planner', '/reports']) {
      await page.goto(pathname);
      await expect(page.locator('#main')).toBeVisible({ timeout: 30_000 });
      await expect(page).not.toHaveURL(/\/login/);
    }

    // 登出
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dashboard');
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

    // 登出后受保护页面应当再次被拦
    await page.goto('/mistakes');
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  });

  test('密码错误时给出提示，且不泄露账号是否存在', async ({ page }) => {
    const user = await registerTestUser(page.request);
    await page.context().clearCookies();

    await page.goto('/login');
    await page.locator('input[autocomplete="email"]').fill(user.email);
    await page.locator('input[autocomplete="current-password"]').fill('wrong-password-12345');
    await page.locator('form button[type="submit"]').click();

    // 停留在登录页
    await expect(page).toHaveURL(/\/login/);
    // 提示文案不能区分"用户不存在"与"密码错误"
    await expect(page.getByText('邮箱或密码不正确')).toBeVisible({ timeout: 20_000 });
  });

  test('不存在的账号与错误密码给出同样的提示（防用户枚举）', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[autocomplete="email"]').fill(`e2e-nobody-${Date.now()}@study.test`);
    await page.locator('input[autocomplete="current-password"]').fill('whatever-password');
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText('邮箱或密码不正确')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('已登录用户访问登录页会被带走（不再停留在登录页）', async ({ page }) => {
    await registerOnboardedUser(page.request);

    await page.goto('/login');
    // 已登录时登录页会重定向；具体落到仪表盘
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  });
});
