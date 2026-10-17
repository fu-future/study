# 数据库文档

---

## 1. 当前状态（务必先读）

| 项 | 值 |
|---|---|
| 第一阶段数据源 | **SQLite** |
| 数据库文件 | `.data/dev.db`（相对 `prisma/` 解析的路径是 `file:../.data/dev.db`） |
| ORM | Prisma 6.19.3 |
| 迁移方式 | `prisma migrate`（迁移文件已提交，位于 `prisma/migrations/`） |
| 表数量 | **20** |
| PostgreSQL | **未启用**，只提供可选的参考产物（见第 6 节） |

> ⚠️ **重要**：迁移到 PostgreSQL **不是改一行 `DATABASE_URL` 就能完成的**。
> 第 6 节列出了必须逐项核对的差异清单。

---

## 2. 为什么第一阶段用 SQLite

开发环境没有 Docker，也没有本地 PostgreSQL。为了让第一版**只装 Node.js + npm 就能跑起来**，
数据源选择 SQLite。为了让同一个数据模型在两种数据库上都成立，schema 刻意遵守以下约定
（见 `prisma/schema.prisma` 顶部注释）：

| 约定 | 原因 |
|---|---|
| **不使用原生 enum** | SQLite 不支持。改用 `String` 落库，取值域由 `src/lib/domain/enums.ts` 的 Zod 在写入前强制校验 —— 类型安全在应用层保证，而不是依赖数据库方言 |
| **不使用 `Json` 类型** | 两种方言语义不一致。结构化小数据统一存 TEXT，由 `src/lib/db/json.ts` 安全序列化/反序列化（带 Zod 校验，坏数据自动降级） |
| **不使用数组字段**（`String[]` / `Int[]`） | SQLite 不支持。用关联表或 JSON TEXT 表达 |
| **不使用 `@db.*` 原生类型修饰符** | 避免方言差异 |
| **不用 Decimal 做统计** | 学习统计一律用 `Int` / `Float`，避免运行时精度差异 |

**方言差异只在一个地方收敛**：`src/lib/db/search.ts` 的 `containsFilter()`。
SQLite 的 `LIKE` 对 ASCII 不区分大小写，PostgreSQL 默认区分大小写（需要 `mode: 'insensitive'`）；
该函数按运行时方言自动生成正确的过滤条件，因此**业务代码不需要知道方言**。

---

## 3. 表结构

### 3.1 总览

| 分组 | 表 |
|---|---|
| 用户与档案 | `User`、`StudentProfile` |
| 课程体系 | `Subject`、`Curriculum`、`KnowledgePoint`、`KnowledgePointRelation` |
| 题目与错题 | `Question`、`QuestionKnowledgePoint`、`WrongAnswerRecord`、`AnswerAttempt` |
| 掌握诊断 | `UserKnowledgeMastery` |
| 学习资源 | `LearningResource`、`ResourceKnowledgePoint` |
| 计划与复习 | `StudyPlan`、`StudyTask`、`StudySession`、`ReviewSchedule` |
| 答疑 | `Conversation`、`Message` |
| 可观测性 | `ModelCallLog` |

### 3.2 关系图（文字版）

```
User ─1:1─ StudentProfile
     ├─* Question ─*:*─ KnowledgePoint      （经 QuestionKnowledgePoint）
     │     └─* WrongAnswerRecord ─1:1─/*─ ReviewSchedule
     │     └─* AnswerAttempt
     ├─* UserKnowledgeMastery ─*:1─ KnowledgePoint
     ├─* StudyPlan ─1:*─ StudyTask ─0:*─ AnswerAttempt
     ├─* StudySession
     ├─* Conversation ─1:*─ Message
     └─* ModelCallLog

Subject ─* Curriculum ─* KnowledgePoint ─self─ parentId（树）
                                  └─* KnowledgePointRelation（有向图：prerequisite 等）
                                  └─* ResourceKnowledgePoint ─*:1─ LearningResource
```

### 3.3 关键约束与索引（业务含义）

| 表 | 约束 | 为什么 |
|---|---|---|
| `User` | `email` 唯一 | 登录标识 |
| `StudentProfile` | `userId` 唯一 | 一个用户只有一份档案 |
| `KnowledgePoint` | `code` 唯一；`(subjectId, chapterPath, name, grade)` 唯一 | `code` 让 CSV 导入可幂等 upsert |
| `KnowledgePointRelation` | `(fromId, toId, relationType)` 唯一 | 防止重复边 |
| `QuestionKnowledgePoint` | `(questionId, knowledgePointId)` 唯一 | 题目↔知识点多对多 |
| `WrongAnswerRecord` | **`(userId, questionId)` 唯一** | 一道题在一个用户下只有一条错题记录；**多次作答放在 `AnswerAttempt`** |
| `UserKnowledgeMastery` | **`(userId, knowledgePointId)` 唯一** | 学习者×知识点掌握情况唯一 |
| `ReviewSchedule` | `(userId, wrongAnswerRecordId)` 唯一、`(userId, knowledgePointId)` 唯一 | 复习计划只能挂在一个对象上 |
| `ResourceKnowledgePoint` | `(resourceId, knowledgePointId)` 唯一 | 资源↔知识点 |

常用索引（均已在迁移中创建）：
`WrongAnswerRecord(userId,status)`、`(userId,nextReviewAt)`、`(userId,createdAt)`；
`AnswerAttempt(userId,createdAt)`、`(userId,questionId)`、`(context)`；
`StudyTask(userId,scheduledDate)`、`(userId,status)`；
`ReviewSchedule(userId,dueAt,status)`；`ModelCallLog(userId,createdAt)`、`(service,createdAt)`、`(status)`。

### 3.4 删除与归档策略

**默认软删除，不做级联物理删除**：

- `User.isArchived`、`Question.isArchived` / `status`、`WrongAnswerRecord.isArchived`、
  `Conversation.isArchived`、`StudyPlan.isArchived` —— 查询层统一过滤，避免误删学习记录。
- `DELETE /api/account` 只是把用户置为归档，**不物理删除**其题目、作答与掌握度记录。
- 只有 `Question → QuestionKnowledgePoint`、`Conversation → Message` 使用
  `onDelete: Cascade`：这些是从属数据，主记录没了它们也没有意义。

所有表都带 `createdAt`，可变表带 `updatedAt`。

---

## 4. 日常操作

```bash
npm run db:generate   # 生成 Prisma 客户端（改了 schema 后必须执行）
npm run db:migrate    # 开发模式：创建并应用新迁移
npm run db:deploy     # 部署模式：只应用已存在的迁移
npm run db:seed       # 写入演示数据（幂等）
npm run db:reset      # ⚠️ 清空重建 + 重新写入演示数据（仅开发环境！）
npm run db:studio     # 可视化查看与编辑
```

### 4.1 备份（SQLite）

SQLite 就是单个文件，直接复制即可。**建议先停掉服务**，避免复制到写入中途的文件。

```bash
mkdir -p .data/backup
cp .data/dev.db ".data/backup/dev-$(date +%Y%m%d-%H%M%S).db"
```

恢复：把备份文件复制回 `.data/dev.db` 后重启服务。

> `.data/` 已被 `.gitignore` 忽略。**不要把数据库文件提交到版本库** —— 里面是真实的用户学习数据。

### 4.2 上传的题目图片

图片存放在 `UPLOAD_DIR`（默认 `.data/uploads`），**不在 `public/` 下**，
只能通过带鉴权的 `GET /api/files/[id]` 读取。备份时连同 `.data/uploads` 一起复制。

---

## 5. 演示数据说明

`prisma/seed.ts` 会写入（幂等，可重复执行）：

- 9 个学科、5 个教材版本
- **19 个知识点 + 10 条前置关系 + 19 个内部资源**
- 一个演示账号 `demo@study.local` / `study-coach-2026`
- 8 道演示错题 + 30 条作答记录
- 最后一步会**调用真实的诊断算法**（`src/lib/diagnosis/engine.ts`）回填掌握度，
  这样演示数据反映的是线上真实会得到的结论，而不是硬编码的假数字

> ⚠️ **演示数据声明**：知识点目录是**人工整理的教学示例**，来源标记为 `source: 'demo-seed'`，
> `sourceNote` 写明"演示数据（人工整理的示例目录，非官方课程标准）"，界面会显示为演示数据。
> 它**不是**官方课程标准的完整复刻，也没有逐条核对教材页码。
> 正式使用前应由教研人员用 CSV/JSON 导入真实目录替换。

---

## 6. 迁移到 PostgreSQL

### 6.1 必须先明白的事

**迁移不是改一行 `DATABASE_URL` 就能完成的。** 除了连接串，至少还要处理：

1. 迁移历史无法直接复用（SQLite 生成的 SQL 与 PostgreSQL 语法不同）
2. 已有数据的**导出与导入**（需要单独写脚本，本项目**没有**提供数据迁移脚本）
3. 大小写敏感的模糊搜索行为变化（已由 `containsFilter()` 处理，但需实测确认）
4. 并发写入能力提升后，需要重新评估连接池大小（`connection_limit`）
5. 服务器/容器需要额外的数据库服务、备份策略、监控

### 6.2 本项目提供的辅助产物（**均未在真机验证**）

```bash
npm run pg:schema          # 生成 prisma/schema.postgres.prisma
npm run pg:migration:sql   # 离线推导 prisma/postgres-reference/0001_init.sql
```

- `scripts/make-postgres-schema.mjs` 只把 `provider = "sqlite"` 替换为 `"postgresql"`，
  其余 1:1 保留，方便人工 diff 审查。
- `scripts/generate-postgres-migration.mjs` 用
  `prisma migrate diff --from-empty --to-schema-datamodel` **离线**推导建表 SQL，
  **不需要数据库连接**。

> ⚠️ 这两个产物 **没有在任何真实 PostgreSQL 实例上执行过**，
> 因此**不能**标记为"迁移成功"。它们只是给未来迁移提供可检查的起点。

### 6.3 真机迁移清单（逐步核对）

```text
[ ] 1. 准备一个**测试用** PostgreSQL 实例（不要直接动生产库）
[ ] 2. 设置 DATABASE_URL=postgresql://user:pass@host:5432/dbname?schema=public
[ ] 3. npm run pg:schema      # 生成 Postgres 版 schema
[ ] 4. 在测试库上执行 prisma/postgres-reference/0001_init.sql，
       或改用 `prisma migrate dev --schema prisma/schema.postgres.prisma --name init`
[ ] 5. 用真实 schema 实测：prisma validate / prisma db pull 比对差异
[ ] 6. 验证 `containsFilter()` 在 Postgres 下的大小写行为（写一条集成测试）
[ ] 7. 编写并执行**数据迁移脚本**（本项目未提供）：逐表导出 SQLite → 导入 Postgres
[ ] 8. 迁移后逐项核对行数：User / Question / WrongAnswerRecord / AnswerAttempt /
       UserKnowledgeMastery / StudyTask / ReviewSchedule
[ ] 9. 检查唯一约束与外键是否全部生效（尤其是 (userId, questionId)）
[ ] 10. 跑一遍完整 E2E（把 DATABASE_URL 指向 Postgres 测试库）
[ ] 11. 至少观察一个完整学习周期（录入→作答→诊断→计划→复习→报告）的数据正确性
[ ] 12. 确认备份与恢复流程可用后，才考虑切生产
```

未完成上述核对之前，**不要**在生产环境使用 PostgreSQL 数据源。

---

## 7. 时间与时区约定

- 所有 `DateTime` 字段统一按 **UTC** 存储（SQLite 不存时区信息）。
- 计划任务按「日」分组时使用 `startOfDay()`（`src/lib/review/scheduler.ts`）归一到 UTC 零点。
- 周报的周区间为 **周一 00:00 → 下周一 00:00（UTC）**（`weekRange()`）。
- 界面展示时再转本地时区（`src/lib/utils.ts` 的格式化函数）。
