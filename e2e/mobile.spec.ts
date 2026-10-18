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
 * 移动端专项用例。
 *
 * 为什么单独一个 spec：
 *   这个产品的真实使用场景是「学生在手机上用」，而桌面视口下很多问题看不出来 ——
 *   横向溢出、底部栏遮内容、iOS 聚焦放大页面，都只在窄屏 + 触控下暴露。
 *   用 390×844（iPhone 13 的逻辑分辨率）跑，是覆盖手机布局成本最低的方式。
 *
 * 注：这里只验证「布局与可达性」，不重复验证业务逻辑（那些在各自 spec 里）。
 */
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

test.describe('移动端布局与可达性', () => {
  test('底部 Tab 栏可见，五个入口齐全且点击后正确高亮', async ({ page }) => {
    await registerOnboardedUser(page.request);
    await gotoApp(page, '/dashboard');

    const tabBar = page.getByRole('navigation', { name: '快捷导航' });
    await expect(tabBar).toBeVisible();

    for (const label of ['首页', '答疑', '错题本', '计划', '报告']) {
      await expect(tabBar.getByRole('link', { name: label, exact: true })).toBeVisible();
    }

    await tabBar.getByRole('link', { name: '错题本', exact: true }).click();
    await expect(page).toHaveURL(/\/mistakes/, { timeout: 30_000 });
    await expect(tabBar.getByRole('link', { name: '错题本', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('主要页面在手机宽度下没有横向溢出', async ({ page }) => {
    await registerOnboardedUser(page.request);

    // 关键：这里必须先"造出真实数据"再检查。
    // 空账号时仪表盘只有空状态，看不到任何卡片；
    // 而横向溢出的元凶恰恰是卡片里的长题干预览（truncate 用的是 nowrap）。
    // 不造数据的话这条用例会假通过 —— 之前就是这么漏掉的。
    const subjectId = await getMathSubjectId(page.request);
    const point = await getReviewedKnowledgePoint(page.request, { subjectId });

    const longStem =
      '已知函数 f(x)=x^3-3ax+1，讨论参数 a 的取值对函数单调性与极值点个数的影响，并说明理由。';

    const firstId = await createMistakeQuestion(page.request, {
      subjectId,
      stem: longStem,
      knowledgePointIds: [point.id],
      studentAnswer: 'a>0 时单调递增',
      errorTypes: ['concept', 'method'],
    });
    await submitAttempt(page.request, firstId, { isCorrect: false, errorTypes: ['concept'] });

    await createMistakeQuestion(page.request, {
      subjectId,
      stem: '求过点 P(1,2) 且与圆 x^2+y^2=5 相切的直线方程，并讨论斜率不存在的情况。',
      knowledgePointIds: [point.id],
      errorTypes: ['calculation'],
    });

    const paths = [
      '/dashboard',
      '/tutor',
      '/mistakes',
      `/mistakes/${firstId}`,
      '/knowledge',
      `/knowledge/${point.id}`,
      '/resources',
      '/planner',
      '/reports',
      '/settings',
    ];

    for (const path of paths) {
      await gotoApp(page, path);
      const width = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      // 允许 1px 的取整误差；超过就说明有元素撑破了视口
      expect(width.scroll, `${path} 出现横向溢出（${width.scroll} > ${width.client}）`).toBeLessThanOrEqual(
        width.client + 1,
      );
    }
  });

  test('输入框字号不小于 16px（iOS 聚焦时不会自动放大页面）', async ({ page }) => {
    await registerOnboardedUser(page.request);
    await gotoApp(page, '/tutor');

    const fontSize = await page
      .locator('#tutor-input')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));

    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  test('底部栏不会遮住页面最后一行内容', async ({ page }) => {
    await registerOnboardedUser(page.request);
    await gotoApp(page, '/mistakes');

    const metrics = await page.evaluate(() => {
      const main = document.querySelector('#main');
      const bar = document.querySelector('nav[aria-label="快捷导航"]');
      if (!main || !bar) return null;
      return {
        paddingBottom: Number.parseFloat(getComputedStyle(main).paddingBottom),
        barHeight: bar.getBoundingClientRect().height,
      };
    });

    expect(metrics, '页面里应当同时存在主内容区与底部栏').not.toBeNull();
    expect(metrics!.paddingBottom).toBeGreaterThanOrEqual(metrics!.barHeight);
  });

  test('可以「添加到主屏幕」：manifest、图标与 viewport 配置齐全', async ({ page }) => {
    const manifestResponse = await page.request.get('/manifest.webmanifest');
    expect(manifestResponse.status()).toBe(200);

    const manifest = (await manifestResponse.json()) as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.display).toBe('standalone');
    expect(manifest.name).toContain('学习教练');
    expect(manifest.start_url).toBe('/dashboard');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );

    for (const icon of manifest.icons) {
      const response = await page.request.get(icon.src);
      expect(response.status(), `图标 ${icon.src} 应当可访问`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    }

    // viewport-fit=cover 是 env(safe-area-inset-bottom) 生效的前提
    await page.goto('/login');
    const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewportMeta).toContain('viewport-fit=cover');
  });
});
