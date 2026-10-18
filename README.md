# AI 高中学习教练（AI Study Coach）

面向中国普通高中学生的智能学习系统。**不是一个聊天机器人**，而是以学习者为中心：
答疑 → 错题 → 知识点 → 薄弱诊断 → 学习计划 → 复习验证 → 学习报告，形成闭环。

> **第一个版本优先保证「真实可运行」**：所有核心功能都有真实的数据流和后端逻辑，
> 算法结论可追溯到具体答题证据，没有数据时显示空状态而不是编造数字。

---

## 1. 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | **≥ 20.9**（实测 22.22.2） | Next.js 15 的最低要求 |
| npm | ≥ 10 | 或 pnpm / yarn（示例命令用 npm） |
| 数据库 | **SQLite（内置，零安装）** | 数据库文件由 Prisma 自动创建，无需单独装数据库服务 |
| Docker | **不需要** | 仅「可选部署」时才用，见 [第 8 节](#8-可选-docker-部署) |
| PostgreSQL | **不需要** | 仅未来迁移时才用，见 [docs/DATABASE.md](docs/DATABASE.md) |

> 本机开发**只需装好 Node.js 和 npm**。第一次启动时会自动建库、建表。

---

## 2. 快速开始（5 步）

```bash
# 1) 安装依赖
npm install

# 2) 准备环境变量（把模板复制一份成本地 .env）
cp .env.example .env
#    然后编辑 .env，至少要改 SESSION_SECRET（见第 4 节）
#    没有 API Key 时保持 AI_PROVIDER=mock 即可运行全部功能

# 3) 一条命令完成：生成 Prisma 客户端 → 应用数据库迁移 → 写入演示数据
npm run setup

# 4) 启动开发服务器（默认 http://localhost:3000）
npm run dev

# 5) 打开浏览器访问 http://localhost:3000 ，用下面的演示账号登录
#    演示账号：demo@study.local / study-coach-2026
#    也可以点「注册」新建自己的账号
```

> **首次启动时数据库文件不存在也没关系** —— `npm run setup` 会创建 `.data/dev.db` 并建好全部 20 张表。

### 生成 `SESSION_SECRET`

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 分步执行（想了解每一步做了什么）

```bash
npm run db:generate   # 生成 Prisma 客户端
npm run db:migrate    # 应用数据库迁移（开发模式，会生成新迁移文件）
npm run db:deploy     # 应用数据库迁移（只应用已有迁移，适用于部署）
npm run db:seed       # 写入演示数据（幂等，可重复运行）
npm run db:reset      # 清空并重建数据库，然后重新写入演示数据
npm run db:studio     # 打开 Prisma Studio 可视化查看数据
```

---

## 3. 目录结构

```
.
├─ prisma/
│  ├─ schema.prisma              # 数据模型（20 个模型，SQLite/PostgreSQL 双兼容）
│  ├─ migrations/                # 数据库迁移（已实际应用）
│  ├─ seed.ts                    # 演示数据（幂等；含真实算法的掌握度回填）
│  └─ postgres-reference/        # 可选：PostgreSQL 参考迁移 SQL（未在真机验证）
├─ scripts/
│  ├─ make-postgres-schema.mjs   # 生成 PostgreSQL 版 schema
│  └─ generate-postgres-migration.mjs  # 离线推导 PostgreSQL 参考迁移 SQL
├─ src/
│  ├─ app/
│  │  ├─ api/                    # 30 个 Route Handler（详见 docs/API.md）
│  │  ├─ (app)/                  # 登录后的页面（受保护布局）
│  │  ├─ login/ register/        # 认证页面
│  │  └─ layout.tsx globals.css
│  ├─ components/                # UI 组件（ui/ 为原语，其余按业务分目录）
│  └─ lib/
│     ├─ ai/                     # AI 网关：provider 抽象 + 适配器 + 5 个服务
│     ├─ diagnosis/              # ★ 掌握度诊断算法（纯函数，可单测）
│     ├─ review/                 # ★ 间隔复习调度（纯函数）
│     ├─ knowledge/              # ★ 前置知识图运算（纯函数）
│     ├─ planning/               # ★ 学习计划生成与时间精简（纯函数）
│     ├─ repositories/           # ★ 唯一的数据访问层（业务代码不直接用 prisma）
│     ├─ db/                     # Prisma 客户端、JSON 字段读写、方言差异收敛
│     ├─ auth/                   # 密码哈希、签名会话、当前用户
│     ├─ storage/                # 题目图片本地存储（含魔数校验）
│     ├─ reports/                # 学习报告统计
│     └─ validation/             # Zod 请求校验
├─ e2e/                          # Playwright 端到端测试（独立库/端口/上传目录）
└─ docs/                         # API / 数据库 / AI Provider 文档
```

**架构分层（重要）**：`API 路由 → 业务服务 → repositories → Prisma`。
路由与业务代码**禁止**直接 `import { prisma }`，这样数据库方言的差异被收敛在一层里。

---

## 4. 环境变量

完整清单与注释见 [`.env.example`](.env.example)。**必填**的只有两项：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | 本地默认 `file:../.data/dev.db`（相对 `prisma/` 解析）。SQLite 相对路径的解析基准是 schema 文件所在目录，这一条容易踩坑 |
| `SESSION_SECRET` | ✅ | 会话签名密钥，**至少 32 字符**。缺失或过短会直接报错退出 |

常用的可选变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `AI_PROVIDER` | `mock` | `mock` / `deepseek` / `openai-compatible` |
| `AI_API_KEY` | 空 | **仅服务端读取，绝不下发到浏览器**。`AI_PROVIDER=mock` 时不需要 |
| `AI_BASE_URL` `AI_MODEL` `AI_VISION_MODEL` | 空 | 端点、文本模型、视觉模型 |
| `AI_TIMEOUT_MS` / `AI_MAX_RETRIES` | 30000 / 2 | 超时与重试 |
| `AI_RATE_LIMIT_PER_MINUTE` | 20 | 每用户每分钟 AI 请求上限 |
| `RESOURCE_SEARCH_PROVIDER` | `internal-only` | 资源检索；`internal-only` 只用已核验资源，最安全 |
| `UPLOAD_MAX_BYTES` | 5242880 | 题目图片大小上限（5 MB） |
| `UPLOAD_DIR` | `.data/uploads` | 图片存放目录（**不在 `public/` 下**，读取必须经过鉴权接口） |
| `ALLOW_SELF_SIGNUP` | `true` | 建完账号后可改成 `false` 关闭注册 |
| `COOKIE_SECURE` | `auto` | 会话 Cookie 是否带 Secure。`auto` = 按 `APP_URL` 是否 https 判断。**用局域网 http 访问时必须保持 `auto` 或 `false`**，设成 `true` 会"登录成功但刷新又回登录页" |
| `PORT` | `3100`（`npm run lan`） | 对外服务端口 |
| `NEXT_DIST_DIR` | `.next` | 构建目录（E2E 用它做隔离） |

> **所有变量在启动时都会用 Zod 校验**（`src/lib/env.ts`），配置错误会直接报错并说明缺哪个字段，
> 不会出现「服务起来了但功能是坏的」。

---

## 5. 数据库

- **第一阶段使用 SQLite**，数据库文件在 `.data/dev.db`（已被 `.gitignore` 忽略）。
- 表结构与关系、备份方式、以及**迁移到 PostgreSQL 的完整步骤**见 [docs/DATABASE.md](docs/DATABASE.md)。

```bash
npm run db:deploy     # 应用已有迁移（部署用）
npm run db:reset      # 重置数据库（会清空数据！仅开发环境）
npm run db:studio     # 可视化查看
```

备份（SQLite 就是单个文件，直接复制即可，**建议先停服**）：

```bash
cp .data/dev.db ".data/backup/dev-$(date +%Y%m%d-%H%M%S).db"
```

---

## 6. 页面一览

| 路径 | 用途 |
|---|---|
| `/dashboard` | 学习仪表盘：今日任务、待复习错题、薄弱知识点、本周进度、快速入口 |
| `/onboarding` | 首次使用向导：年级、教材版本、选科、每日可用时间、学习目标 |
| `/tutor` | AI 智能答疑：**直接拍照 / 上传题目图片识别**、**手动输入题目**，四种讲解模式，流式输出，公式渲染 |
| `/mistakes` | 错题本：筛选、手动录入、图片上传、复习状态 |
| `/mistakes/[id]` | 错题详情：题目、解析、错误原因（可修改）、作答历史、复习操作 |
| `/knowledge` | 知识点地图（按章节分组，显示掌握程度） |
| `/knowledge/[id]` | 知识点详情：掌握证据、诊断结论、前置知识、学习资源 |
| `/resources` | 学习资源（明确区分「已验证」与「未核验」） |
| `/planner` | 学习计划：生成任务、推荐原因、完成任务 |
| `/reports` | 学习报告（四个指标分开呈现 + 证据与不确定性） |
| `/settings` | 学习偏好、AI 配置状态、数据导出与归档 |

---

## 7. 测试

### 单元测试（Vitest，139 个用例，覆盖 4 个核心算法）

```bash
npm test              # 运行一次
npm run test:watch    # 监听模式
```

覆盖：知识掌握度诊断、间隔复习调度、前置知识依赖图、学习计划生成与时间精简。
这些模块都是**纯函数**（不依赖数据库 / AI / 环境变量），所以可以完全离线稳定运行。

### 端到端测试（Playwright）

```bash
npx playwright install chromium   # 首次需要下载浏览器（约 150 MB）
npm run test:e2e
```

**隔离保证**：E2E 使用独立的端口（3300）、数据库（`.data/e2e.db`）、上传目录
（`.data/e2e-uploads`）和构建目录（`.next-e2e`），**不会读写开发用的
`.data/dev.db` 与 `.data/uploads`**。`e2e/global-setup.ts` 会在运行前后比对该文件的
大小与修改时间，一旦发现被改动就立即中止。

### 一键检查

```bash
npm run verify        # 类型检查 + Lint + 单元测试
npm run typecheck     # 仅类型检查
npm run lint          # 仅 Lint
```

---

## 8. 用手机访问（把电脑当服务器）

不想每次都坐在电脑前用？可以让这台电脑直接当服务器，手机连同一个 Wi-Fi 就能打开。

```bash
npm run build     # 生产构建（改过代码才需要重做）
npm run lan       # 监听 0.0.0.0:3100，并打印手机访问地址
```

Windows 上更省事的方式：双击项目根目录的 **`start-lan.bat`**（缺构建产物时会自动构建）。

手机端已针对性优化：底部 5 个 Tab 的单手导航、输入框 16px 字号（iOS 不会缩放页面）、
拍照直接调起相机、上传前在浏览器里自动压缩图片、支持「添加到主屏幕」全屏使用。

防火墙放行（只需一次，管理员 PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\open-firewall.ps1
```

完整步骤、常驻自启、外网访问（Tailscale）、安全清单与排错表见
**[docs/LAN_DEPLOY.md](docs/LAN_DEPLOY.md)**。

### 不在同一个 Wi-Fi 也要用（异地手机）

见 **[docs/REMOTE_ACCESS.md](docs/REMOTE_ACCESS.md)**。两种可行路径：

| 方案 | 说明 |
|---|---|
| **Tailscale**（推荐） | 电脑与手机各装客户端、登录同一账号，手机会拿到 `100.x.x.x` 地址，直接访问 `http://100.x.x.x:3100`。加密、不用改路由器、不向公网暴露端口 |
| **IPv6 直连** | 若宽带有公网 IPv6（本机已具备），在路由器放行 TCP 3100 后，手机用 `http://[IPv6地址]:3100` 访问。无需装软件，但**明文**且前缀会变 |

服务默认监听 `::`（双栈，IPv4 + IPv6 都通），这是 IPv6 直连能成立的前提。

> ⚠️ 三个上线前必做：删掉演示账号或改密、把 `ALLOW_SELF_SIGNUP` 设为 `false`、
> 确认 `COOKIE_SECURE` 不是 `true`（用 http 访问时配成 true 会导致"登录成功但刷新又回登录页"）。

数据备份：

```bash
npm run backup    # 备份到 .data/backups/<时间戳>/
```

---

## 9. 可选 Docker 部署

Docker **不是本地开发的前提**，第一版本地启动完全不需要它。
只有当你要把应用部署到服务器时才需要，见 [docs/DEPLOY.md](docs/DEPLOY.md)。

> ⚠️ **状态说明**：本机的 `Dockerfile` 与 `docker-compose.yml` **没有在真实 Docker
> 环境中执行验证过**（开发机未安装 Docker）。配置已按最佳实践编写并逐项注释，
> 但不能声称"已验证可部署"。详见 `docs/DEPLOY.md` 顶部的验证状态说明。

---

## 10. 安全说明

| 措施 | 实现位置 |
|---|---|
| API Key 只在服务端 | `src/lib/env.ts` 在客户端导入时直接抛错；密钥从不下发 |
| 密码哈希（scrypt） | `src/lib/auth/password.ts`，格式含成本参数便于升级 |
| 会话签名（HMAC-SHA256） | `src/lib/auth/session.ts`，httpOnly + sameSite |
| 数据归属校验 | 所有查询/更新都带 `userId` 条件，见 `src/lib/repositories/*` |
| 文件访问需鉴权 | 图片不在 `public/` 下，只能通过 `/api/files/[id]` 读取 |
| 上传校验 | 声明类型 + **真实字节魔数** + 大小上限三重校验 |
| AI 限流 | `src/lib/ai/rate-limit.ts`，按「用户 × 服务」分桶 |
| 错误不泄露内部信息 | `src/lib/api/http.ts` 统一包装，5xx 只返回通用提示 |
| 日志脱敏 | `src/lib/logger.ts` 对 password/token/secret 等字段自动打码 |

**不要把 `.env` 提交到版本库**（`.gitignore` 已忽略）。

---

## 11. 常见问题（FAQ）

**Q1. 启动时报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` 或服务器莫名退出？**
本机环境的文件删除守卫会拦截 Next.js 清理 `.next` 目录的操作。
解决：启动前先把 `.next` 改名而不是删除。

```bash
[ -d .next ] && mv .next ".next.bak.$(date +%s)"
npm run dev
```

同理，修改 `next.config.mjs` 会触发 Next 自动重启并清理 `.next`，可能因此退出 —— 改完配置后手动重启即可。

**Q2. 端口被占用？**
```bash
npx next dev -p 3100        # 换端口
```

**Q3. 页面没有任何数据？**
先确认已写入演示数据：`npm run db:seed`。新注册的账号是**空账号**，
需要先完成建档向导、录入错题并做几次练习，才会有掌握度与报告数据 —— 这是刻意的设计，
不会在没有证据时编造数字。

**Q4. AI 回复说的是「Mock 模式」，没有真正的解题过程？**
当前是 `AI_PROVIDER=mock`。Mock Provider **刻意不生成**看起来像真答案的内容，
免得造成误解。配置真实 API Key 后即可获得真实讲解，见
[docs/AI_PROVIDER.md](docs/AI_PROVIDER.md)。

**Q5. 上传题目图片失败？**
只接受 PNG / JPG / WEBP，且不超过 5 MB。**校验依据是文件真实字节（魔数），
不是扩展名** —— 把 `.txt` 改名成 `.png` 依然会被拒绝。

**Q6. 图片识别总是提示"当前配置的模型不支持图片识别"？**
需要单独配置支持视觉的模型：在 `.env` 设置 `AI_VISION_MODEL`。
注意 `deepseek-chat` **不支持**图片输入，不能拿它当视觉模型用。
也可以直接手动录入题目内容 —— 手动录入同样能获得完整的错题分析。

**Q7. E2E 报错说找不到浏览器？**
```bash
npx playwright install chromium
```

**Q8. Prisma 报错 `Environment variable not found: DATABASE_URL`？**
确认项目根目录存在 `.env`（从 `.env.example` 复制而来），且 `DATABASE_URL` 一行未被注释。

---

## 12. 当前完成度（诚实清单）

**已实测通过：**
- 类型检查 0 错误、Lint 0 问题
- 单元测试 139 个用例全部通过
- 端到端：**66 个用例全部通过**（Chromium），见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)
- 核心链路经真实 HTTP 实测：注册登录 → 建档 → 知识点 → 掌握度诊断（含证据链）
  → 计划生成（含时间精简）→ 周报 → 流式答疑 → 跨用户隔离
- 生产构建通过（43 个路由），`next start` 实测可运行
- **真实 DeepSeek 接口已验收**：文本答疑 / 流式 / 多轮上下文 / 结构化错题分析 /
  **题目图片识别** / 输入限制 / token 用量 —— 16 项全部通过，0 失败
  （复现：`node scripts/acceptance-ai.mjs` 与 `node scripts/acceptance-ai-vision.mjs`）

**已实现但未在真实环境验证：**
- **Docker 部署**：配置文件已写好，开发机未安装 Docker，**未实际执行验证**。
- **PostgreSQL 迁移**：只离线推导出参考 SQL，**未在真实 PostgreSQL 上执行过**。
  并且**迁移不是改一行 `DATABASE_URL` 就能完成的**，请按 docs/DATABASE.md 的清单逐项核对。
- **上游限流 / 鉴权失败路径**：代码已按状态码映射实现，但未构造真实的上游 429 / 401 场景实测。

**已知限制：**
- 限流是**进程内**实现，多实例部署需要换成 Redis 等共享存储。
- 知识点目录是**人工整理的演示数据**（非官方课程标准复刻），正式使用前应由教研人员
  用 CSV/JSON 导入真实目录。
- 资源检索默认只用库内已核验资源；接入外部搜索 API 后，其结果一律标记为「未核验」。
- **使用推理模型（如 `deepseek-flash`）时 `AI_MAX_OUTPUT_TOKENS` 需 ≥ 8192**：
  思考过程与正式回答共用这个额度，设小了会出现"思考用光预算、正文为空"。
  详见 [docs/AI_PROVIDER.md](docs/AI_PROVIDER.md) 第 5 节。
- 检索关键词与计划推荐语由规则引擎生成，未做多轮个性化调优。

---

## 13. 许可与数据声明

- 学习数据仅用于提供学习服务，默认不公开，支持导出与归档。
- 面向未成年人设计：数据最小化、不做焦虑式提醒、不与他人比较。
- 本项目不含任何真实的第三方 API 密钥；演示账号密码仅用于本地体验。
