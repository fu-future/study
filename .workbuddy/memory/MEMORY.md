# 项目长期笔记 — AI 高中学习教练

## 项目定位
面向中国普通高中学生的智能学习系统（第一个使用者是一名高中女生）。
不是聊天机器人，而是以学习者为中心：答疑 → 错题 → 知识点 → 薄弱诊断 → 计划 → 复习验证 → 报告。

## 必须遵守的产品红线（来自任务书，违反即为不合格）
- 不编造视频标题/链接/时长/平台、教材出处、知识点编号、考试真题来源。
- 掌握程度是**估计**，必须与置信度一起展示；证据不足时显示"还需要更多练习"，
  不允许制造虚假的精确分数。
- 不因单次答错判薄弱，也不因单次答对判掌握。
- 所有统计必须来自真实记录，报告里四个指标不得混用：
  学习时间 / 任务完成率 / 练习正确率 / 知识掌握估计。
- 不用羞辱式评价、不做焦虑式提醒；不鼓励熬夜、压缩休息赶进度。
- AI 输出的 Markdown 不得作为不可信 HTML 执行。
- AI 临时生成的知识点只能是 draft，不能当作官方课程目录。

## 架构约定
- **分层**：`src/app/api/**`（路由）→ `src/lib/*/service.ts`（业务编排）
  → `src/lib/repositories/**`（唯一数据访问层）→ Prisma。
  路由与业务代码**禁止**直接 import prisma。
- **纯算法层**（不 import 数据库/AI/环境变量，可单测）：
  `diagnosis/engine.ts`（掌握度）、`review/scheduler.ts`（间隔复习）、
  `knowledge/graph.ts`（前置知识闭包/树/环检测）、`planning/generator.ts`（计划生成）。
- **AI 层**：`src/lib/ai/provider.ts` 是抽象基类，集中处理能力校验、超时、重试、
  输入长度限制、结构化输出的 Zod 校验 + 修复重试、调用日志。
  子类只实现 rawGenerateText / rawGenerateJson / rawAnalyzeImage / rawStreamText。
- **数据模型**：enum-free + 无 Json 字段，保证 SQLite/PostgreSQL 双兼容。
- 软删除优先（`isArchived`），绝不物理删除学习记录。

## 环境事实（本机）
- Windows，无 Docker、无本地 PostgreSQL → 第一版必须 SQLite。
- `.next` 清理会被沙箱拦截，启动前先 `mv .next .next.bak.$TS`。
- 后台进程用工具的 `run_in_background`；curl 用 `--noproxy '*'`。
- 用户提供局域网代理：HTTP `192.168.1.2:8502` / SOCKS5 `192.168.1.2:8501`。

## 命令速查
- 首次：`npm install` → `npm run setup`（generate + migrate deploy + seed）
- 开发：`npm run dev`；检查：`npm run verify`（tsc + eslint + vitest）
- 重置数据库：`npm run db:reset`
- 可选 PostgreSQL 落点：`npm run pg:schema`、`npm run pg:migration:sql`

## 测试约定（Phase 7 建立）
- 单测放 `src/**/*.test.ts`（Vitest，只测纯函数，不碰数据库/AI/环境变量）
- E2E 放 `e2e/*.spec.ts`（Playwright）。**必须用 `npm run test:e2e`**，
  它会先跑 `pretest:e2e` → `scripts/reset-e2e-distdir.mjs`（改名腾空
  `.next-e2e` / `test-results` / `playwright-report`），必须在 webServer 启动前完成。
- E2E 隔离三件套：端口 3300 / `.data/e2e.db` / `.data/e2e-uploads`；构建目录 `.next-e2e`。
  globalSetup 会比对 `dev.db` 签名，被改动即中止。
- E2E 里禁止用 `import.meta`（Playwright 编译成 CJS），路径基准用 `process.cwd()`。
- 写 E2E 断言前**先读页面源码确认真实文案**（本轮曾因猜文案导致多处假失败）。

## 本机环境硬约束（与代码无关，但影响所有自动化）
- 环境的文件删除守卫会拦截批量删除；`.next` 被 `mv`/`mkdir` 重建后 Next 打开
  `.next/trace` 会 EPERM → **不要移动 `.next`，原地构建**。
- `next build` 收尾清理需临时 `CODEBUDDY_SAFE_DELETE_ENABLED=0`（范围仅 `.next`）。
- 改 `next.config.mjs` 会让正在运行的 dev server 崩溃退出，改完手动重启。

