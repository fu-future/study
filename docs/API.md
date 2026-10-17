# API 文档

本文件与 `src/app/api/**` 下的 30 个 Route Handler **一一对应**。
路由清单可从代码自动核对：

```bash
# 列出所有 API 路由与其 HTTP 方法
node -e "const fs=require('fs'),p=require('path');(function w(d,o=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);e.isDirectory()?w(f,o):e.name==='route.ts'&&o.push(f)}return o})('src/app/api').sort().forEach(f=>{const s=fs.readFileSync(f,'utf8');console.log([...(s.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=/g))].map(m=>m[1]).join('|'),'/'+p.relative('src/app',p.dirname(f)).replace(/\\\\/g,'/'))})"
```

---

## 1. 通用约定

### 1.1 响应格式

所有接口（除 `/api/chat` 的流式响应与 `/api/files/[id]` 的二进制响应）都返回统一信封：

**成功**
```json
{ "ok": true, "data": { } }
```

**失败**
```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "提交的内容有误，请检查标红的字段。", "details": { "stem": "请填写题干" } } }
```

- `error.message` 是**面向学生的中文提示**，可直接展示。
- `error.details` 在参数校验失败时给出**字段级错误**，键为字段路径。
- 服务端内部错误只返回通用提示，**不会**包含堆栈、SQL、文件路径或密钥。

### 1.2 认证

- 使用 **httpOnly 签名 Cookie**（名称 `sc_session`），登录/注册接口成功后自动下发。
- 浏览器端无需手动处理 token；`fetch` 带上同源 Cookie 即可。
- 未登录调用受保护接口返回 **401** + `error.code = "UNAUTHORIZED"`。
- 访问不属于自己的资源返回 **404**（而不是 403 —— 避免泄漏"该 id 存在"这一信息）。
- 权限不足（如非管理员维护资源库）返回 **403** + `FORBIDDEN`。

### 1.3 错误码表

| `error.code` | HTTP | 含义 |
|---|---|---|
| `VALIDATION_ERROR` | 400 | 请求参数不合法（含字段级 details） |
| `UPLOAD_REJECTED` | 400 | 文件类型/大小不合规 |
| `UNAUTHORIZED` | 401 | 未登录或会话无效 |
| `FORBIDDEN` | 403 | 已登录但无权限 |
| `NOT_FOUND` | 404 | 资源不存在或不属于当前用户 |
| `CONFLICT` | 409 | 唯一约束冲突（如邮箱已注册） |
| `RATE_LIMITED` | 429 | 请求过于频繁（AI 接口限流） |
| `UNSUPPORTED` | 501 | 功能未实现（**不会**返回假成功） |
| `AI_CAPABILITY_UNSUPPORTED` | 501 | 当前模型不支持该能力（如图片理解） |
| `AI_UPSTREAM_ERROR` | 502 | AI 上游返回错误 |
| `AI_INVALID_OUTPUT` | 502 | 结构化输出未通过校验（重试后仍失败） |
| `AI_NOT_CONFIGURED` | 503 | AI 未配置（如选了真实 provider 但缺 Key） |
| `AI_TIMEOUT` | 504 | AI 调用超时 |
| `INTERNAL_ERROR` | 500 | 服务端异常（消息已脱敏） |

### 1.4 限流

AI 相关接口按「用户 × 服务」分桶限流，默认每用户每分钟 20 次（`AI_RATE_LIMIT_PER_MINUTE`）。
超限返回 429，`message` 会告知需要等待的秒数。

---

## 2. 接口清单

### 2.1 健康检查（公开）

#### `GET /api/health`

无需登录；数据库不可用时返回 `status: "degraded"` 但 HTTP 仍为 **200**（便于负载均衡探活）。

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-10-16T17:09:16.090Z",
    "database": { "ok": true },
    "ai": {
      "provider": "mock",
      "label": "Mock Provider（离线开发用）",
      "defaultModel": "mock-study-coach",
      "visionModel": "mock-vision",
      "capabilities": { "text": true, "streaming": true, "structured": true, "vision": true, "maxInputChars": 48000, "structuredFallback": "json-mode" },
      "isRealProvider": false
    },
    "config": { "ok": true, "missing": [], "dbDialect": "sqlite", "aiProvider": "mock", "aiConfigured": false, "aiVisionConfigured": false, "errors": [] },
    "dialectNotes": ["..."]
  }
}
```

> 该接口**只报告"是否已配置"，不返回任何密钥值**。

---

### 2.2 认证

#### `POST /api/auth/register` （公开）

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `email` | string | ✅ | 合法邮箱，≤120 字符，会转小写 |
| `displayName` | string | ✅ | 1–30 字符 |
| `password` | string | ✅ | 8–72 字符，拒绝明显弱口令 |

返回 `{ ok: true, data: { user: { id, email, displayName, role } } }` 并下发会话 Cookie。
`ALLOW_SELF_SIGNUP=false` 时返回 403；邮箱已存在返回 409 `CONFLICT`。

#### `POST /api/auth/login` （公开）
请求 `{ email, password }`。用户不存在与密码错误**返回同样的提示**（防用户枚举）：
401 + `"邮箱或密码不正确。"`

#### `POST /api/auth/logout` （公开）
清除会话 Cookie，返回 `{ ok: true, data: { loggedOut: true } }`。

#### `GET /api/auth/me`
返回 `{ ok: true, data: { user: SessionUser | null } }`。未登录**不是错误**，`user` 为 `null`。

---

### 2.3 学习档案

#### `GET /api/profile`
返回 `{ user, profile, subjects, curriculums }`。
`profile` 中 `electiveSubjects` 已解析为字符串数组，`examDate` 为 ISO 字符串或 `null`。

#### `PATCH /api/profile`
可更新：`grade`、`curriculumId`、`textbookVersion`、`electiveSubjects`（最多 6 个学科代码）、
`studyGoal`、`examDate`、`dailyAvailableMinutes`（15–600）、`weekdayAvailableMinutes`、
`weekendAvailableMinutes`、`reminderEnabled`、`reminderTime`（`HH:mm`）、`preferences`、
`onboardingCompleted`。返回结构同 GET。

#### `GET /api/subjects`
返回 `{ ok: true, data: { items: [{ id, code, name, isElective, sortOrder }] } }`。

---

### 2.4 知识点

#### `GET /api/knowledge-points`

| 查询参数 | 说明 |
|---|---|
| `subjectId` | 学科 **id 或 code** |
| `grade` | `高一` / `高二` / `高三` |
| `chapter` | 一级章节名 |
| `search` | 关键字（匹配名称/章节路径/说明/编码） |
| `reviewStatus` | `draft` / `reviewed` / `deprecated` |
| `limit`（默认 200，上限 500）、`offset` | 分页 |
| `withMastery` | `true` 时附带当前用户对该知识点的掌握摘要 |

`item.commonMistakes` / `typicalQuestionTypes` 已解析为字符串数组。

---

### 2.5 AI 答疑

#### `POST /api/chat` — **SSE 流式**

请求体：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message` | string | ✅ | 1–4000 字符 |
| `mode` | enum | | `guided`(默认) / `detailed` / `exam-review` / `quick` |
| `conversationId` | string | | 多轮对话时传上一轮返回的会话 id |
| `subjectId` | string | | 学科 id 或 code |
| `grade` | enum | | 覆盖档案里的年级 |
| `questionId` | string | | 从错题本发起追问时带上 |

**响应**：`Content-Type: text/event-stream`，每行 `data: <JSON>`：

```
data: {"type":"start","model":"mock-study-coach","providerId":"mock","conversationId":"cmvb..."}
data: {"type":"delta","text":"...","conversationId":"cmvb..."}
data: {"type":"usage","usage":{"promptTokens":123,"completionTokens":456},"conversationId":"cmvb..."}
data: {"type":"done","latencyMs":812,"retryCount":0,"conversationId":"cmvb..."}
data: [DONE]
```

失败时也可能出现 `{"type":"error","code":"AI_TIMEOUT","message":"..."}`。
**客户端断开连接时会中止上游请求**（避免继续计费）。

#### `GET /api/conversations`
返回 `{ items: [{ id, title, mode, subjectId, subjectName, messageCount, createdAt, updatedAt }] }`。
会话标题由首条提问自动生成。

#### `GET /api/conversations/[id]`
返回 `{ conversation, messages: [{ id, role, content, contentType, metadata, createdAt }] }`。

---

### 2.6 题目与错题

#### `GET /api/questions`

| 查询参数 | 说明 |
|---|---|
| `onlyMistakes` | `true` 时走错题本（带错题记录与复习状态） |
| `subjectId` / `knowledgePointId` / `search` / `source` / `status` | 筛选 |
| `limit`（默认 50，上限 100）/ `offset` | 分页 |

`QuestionSummary` 结构：

```json
{
  "id": "...", "stem": "...", "stemFormat": "text", "choices": [],
  "subjectId": "...", "subjectName": "数学", "grade": "高二", "chapter": "...",
  "correctAnswer": "...", "explanation": "...",
  "imagePath": "uuid.png", "imageUrl": "/api/files/uuid.png",
  "source": "manual", "sourceNote": "...", "status": "active",
  "createdAt": "...", "updatedAt": "...",
  "knowledgePoints": [{ "id": "...", "name": "...", "chapterPath": "...", "isPrimary": true }],
  "mistake": {
    "id": "...", "status": "needs-review", "studentAnswer": "...",
    "errorTypes": ["concept"], "likelyCauses": ["..."], "errorConfidence": 0.62,
    "editedByUser": false, "attemptCount": 3, "correctCount": 1,
    "lastReviewedAt": "...", "lastReviewResult": "wrong", "nextReviewAt": "...",
    "confidenceNote": "AI 对错误原因的把握不高，建议你自己核对一下，也欢迎直接修改。"
  }
}
```

#### `POST /api/questions`
创建题目（并可选同时建错题记录与首次复习计划）。

| 字段 | 必填 | 说明 |
|---|---|---|
| `subjectId` | ✅ | 学科 id 或 code |
| `stem` | ✅ | 1–6000 字符 |
| `choices` | | 最多 10 项 |
| `correctAnswer` / `explanation` / `chapter` / `grade` / `sourceNote` | | |
| `createMistake` | | `true` 时建立错题记录 + 首次复习计划 |
| `studentAnswer` | | 学生原始答案 |
| `errorTypes` | | 错误原因分类（多选，见 `ERROR_TYPES`） |
| `knowledgePointIds` | | 直接关联的知识点（最多 6 个），第一项为主知识点 |

返回 `{ question, mistakeCreated, firstReview }`。

#### `GET /api/questions/[id]`
返回 `{ question, attempts, wrongRecord, reviewHistory }`。
`attempts` 是**按时间正序的全部作答记录**（不是只有最后一次）。

#### `PATCH /api/questions/[id]`
可更新题干、选项、答案、解析、学科、章节、状态；若带 `mistake` 子对象，
则同步更新错题记录，并把 `editedByUser` 置为 `true`（表明**学生手动修改过 AI 的分析**）。

#### `DELETE /api/questions/[id]`
**归档**（软删除）题目，返回 `{ archived: true }`。不会物理删除学习记录。

#### `POST /api/questions/upload`
`multipart/form-data`，字段名 `file`。校验：**真实字节魔数**（PNG/JPG/WEBP）+ 大小上限。
返回 `{ uploadId, mimeType, bytes, url }`。失败返回 400 `UPLOAD_REJECTED`。

#### `POST /api/questions/analyze`
识别并分析题目。带 `uploadId` 时先做图片识别，否则分析文本。

| 字段 | 说明 |
|---|---|
| `uploadId` | 已上传图片的 id（与 `stem` 二选一） |
| `stem` / `choices` / `studentAnswer` / `correctAnswer` | 文本输入 |
| `subjectId` / `grade` / `hint` | 上下文 |
| `createMistake` | 分析后是否直接落库为错题 |

返回 `{ analysis, matchedKnowledgePoints, rejectedKnowledgePointCodes, model, providerId, latencyMs, isMock, needsUserConfirmation, question?, mistakeCreated?, firstReview? }`

- `rejectedKnowledgePointCodes`：模型引用了**目录中不存在**的知识点编码（幻觉），已被服务层丢弃。
- `needsUserConfirmation`：题干缺失/图片不清晰时为 `true` —— 界面应引导学生确认，**不能把 AI 推测当结论**。
- 当前模型不支持图片理解时返回 501 `AI_CAPABILITY_UNSUPPORTED`（不静默降级）。

#### `POST /api/questions/[id]/attempts`
提交一次作答。

```json
{ "answer": "…", "isCorrect": false, "independence": "independent",
  "difficultySnapshot": 3, "timeSpentSeconds": 180,
  "errorTypes": ["calculation"], "note": "…", "context": "practice" }
```

- `independence`：`independent` / `with-hint` / `with-solution` —— **看了解析才做对不能算掌握**，这是诊断的关键输入。
- `context`：`initial` / `practice` / `review` / `retest`。

返回 `{ attempt, review, mastery: [{ knowledgePointId, knowledgePointName, level, score, confidence, evidenceCount, recentAccuracy, needsPrerequisiteReview, nextAction }] }`。

#### `POST /api/questions/[id]/review`
提交错题复习。请求 `{ result: "correct"|"partial"|"wrong", independence, answer?, timeSpentSeconds? }`。
返回结构同上；`review` 包含新的 `dueAt` / `intervalDays` / `repetition` / `easeFactor` / `overdueDays`。

#### `GET /api/files/[id]` — 二进制
**必须登录**。返回图片字节（`Content-Type: image/png|jpeg|webp`，`Cache-Control: private`）。
只接受服务端生成的 `uuid.ext` 形式 id；路径穿越一律被拒绝。

---

### 2.7 知识诊断

#### `GET /api/mastery`

| 查询参数 | 说明 |
|---|---|
| `scope` | `all`(默认) / `weak` / `strong` |
| `subjectId` / `level` | 筛选 |

返回 `{ items, distribution, weakCount, insufficientCount }`。
`item` 含 `level` 与 `levelLabel`（**中文标签**）、`score`、`confidence`、`evidenceCount`、
`recentAccuracy`、`repeatedErrorTypes`、`needsPrerequisiteReview`、`nextAction`、`lastEvaluatedAt`。

> `score` 为 `null` 表示**证据不足**，界面应显示"还需要更多练习"，不能显示 0 分。

#### `GET /api/mastery/[knowledgePointId]`
查询参数 `narrative=true|false`（默认 `false`，关闭时不消耗 AI 额度）。

返回 `{ diagnosis: { knowledgePointId, knowledgePointName, subjectId, chapterPath, result, narrative, narrativeError, prerequisites, evidence, updatedAt } }`

- `result`：确定性算法给出的结论，含 `level` / `score` / `hasScore` / `confidence` /
  `confidenceReasons`（**置信度为什么是这个值的可读说明**）/ `repeatedErrorTypes` / `nextAction`。
- `narrative`：AI 把结论翻译成人话；**失败时为 `null` 且 `narrativeError` 说明原因 —— 诊断本身不受影响**。
- `prerequisites`：需要回补的前置知识（由前置图算法计算，最多回溯 3 层）。
- `evidence`：支持该结论的真实答题证据，可追溯到具体的 `attemptId` / `questionId`。

#### `POST /api/mastery/diagnose`
请求 `{ knowledgePointIds: string[] (1–20), withNarrative?: boolean }` → `{ items: DiagnosisView[] }`。

---

### 2.8 学习资源

#### `GET /api/resources`
筛选：`knowledgePointId` / `subjectId` / `resourceType` / `verificationStatus` / `search` / `limit` / `offset`。
返回 `{ items, total, verifiedCount, unverifiedCount }`。

> `verificationStatus`：`verified`（人工核验过）/ `unverified`（搜索结果，**界面必须显式标注未核验**）/ `unavailable`。

#### `POST /api/resources` — **[管理员]**
维护资源库。`url` 必须是 http/https。`verified: true` 时才会写入核验时间（不自动核验任何东西）。

#### `POST /api/resources/search`
请求 `{ knowledgePointId, subjectId? }`。返回：

```json
{
  "knowledgePoint": { "id": "...", "name": "导数的几何意义", "chapterPath": "...", "subjectName": "数学", "grade": "高二", "difficulty": 4, "commonMistakes": [], "typicalQuestionTypes": [] },
  "verified": [ ResourceView ],
  "unverified": [ ResourceView ],
  "internal": [{ "kind": "explanation", "title": "...", "content": "…markdown…", "isMock": false, "model": "..." }],
  "degraded": true,
  "message": "暂时没有已验证的匹配资源。下面是系统为你生成的讲解和练习…",
  "searchKeywords": ["高二 数学 导数的几何意义 讲解"],
  "searchError": null
}
```

- `degraded: true` 表示**没有已验证的外部资源** —— 界面应显示该提示，并重点呈现系统生成的讲解与练习。
- 外部搜索失败时 `searchError` 给出原因，主体功能不受影响。

---

### 2.9 学习计划

#### `GET /api/study-plans`
返回 `{ items }`（按创建时间倒序，默认 20 条）。

#### `POST /api/study-plans/generate`
请求 `{ planType, dayCount?, from?, replaceUnfinished? }`。

`planType`：`daily`(1天) / `weekly`(7天) / `exam-prep`(7天) / `weak-point`(5天) / `mistake-review`(3天) / `makeup`(2天)。

返回：
```json
{
  "plan": { "id": "...", "title": "10月16日 今日计划", "plannedMinutes": 87, "availableMinutes": 90, "rationale": { "notes": ["…"] } },
  "tasks": [{ "id": "...", "title": "...", "taskType": "practice", "estimatedMinutes": 20, "reason": "…", "completionCriteria": "…", "priority": 4, "status": "pending", "scheduledDate": "..." }],
  "minutesByDay": [{ "date": "...", "minutes": 87, "availableMinutes": 90 }],
  "trimmedCount": 9,
  "totalMinutes": 87
}
```

- **每天安排量不会超过当天可用时间**；超出的任务被精简，`trimmedCount` 与 `rationale.notes` 会如实说明。
- 计划由**规则引擎**生成（`src/lib/planning/generator.ts`），不依赖 AI，因此结果可复现、可解释。
- `generateDailyPlan` 会归档上一个同类计划，但**已完成的任务记录不会被删除**。

#### `PATCH /api/study-tasks/[id]`
可更新 `status` / `scheduledDate` / `priority` / `estimatedMinutes` / `result`。

#### `POST /api/study-tasks/[id]/complete`
请求 `{ actualMinutes?, note?, selfAssessment: "confident"|"unsure", accuracy? }`。
除了把任务置为完成，还会写入一条 `StudySession` —— **"学习时间"是独立于"完成率"的指标**。

---

### 2.10 学习报告

#### `GET /api/reports/weekly`
查询参数 `weekOffset`（`0`=本周，`1`=上一周，最多 52）。周区间为**周一到周日**。

```json
{
  "range": { "from": "...", "to": "...", "label": "本周（10月12日 – 10月18日）" },
  "studyTime":   { "totalMinutes": 0, "sessions": 0, "byDay": [] },
  "tasks":       { "total": 8, "completed": 0, "skipped": 0, "pending": 8, "completionRate": 0, "estimatedMinutes": 0, "actualMinutes": 0, "completedList": [] },
  "practice":    { "total": 8, "correct": 2, "accuracy": 0.25, "bySubject": [] },
  "mastery":     { "distribution": {}, "improved": [], "needsWork": [], "insufficientEvidence": 0 },
  "repeatedErrors": [{ "type": "concept", "label": "概念理解错误", "count": 3 }],
  "review":      { "total": 8, "dueNow": 8, "done": 0, "overdue": 8, "scheduledThisWeek": 8 },
  "mistakes":    { "total": 8, "due": 8, "resolved": 0, "newThisWeek": 0 },
  "suggestions": ["…"],
  "evidenceNotes": ["…"],
  "hasEnoughData": true
}
```

> **四个指标（学习时间 / 任务完成率 / 练习正确率 / 知识掌握估计）必须分开呈现，不得混为一个数字。**
> 没有数据时对应字段为 `null`（而不是 `0`），界面显示空状态。
> `evidenceNotes` 必须展示 —— 它说明掌握程度是估计值、当前有多少条证据、哪些结论还不可靠。

---

### 2.11 数据权利

#### `GET /api/account/export`
导出当前用户的全部学习数据（JSON，`Content-Disposition: attachment`）。
**不包含密码哈希**。可选包含对话记录。

#### `DELETE /api/account`
**归档**账号（软删除：`isArchived = true`），并清除会话 Cookie。
不做物理删除，因此学习记录仍可在需要时恢复；这是面向未成年人的保守策略。
