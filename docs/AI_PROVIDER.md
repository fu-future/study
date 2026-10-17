# AI Provider 配置与验收

---

## 1. 设计原则

1. **业务代码不认识任何一家模型 SDK**。所有 AI 调用都经过
   `src/lib/ai/provider.ts` 的抽象接口（`AiProvider`），换供应商只需改 `.env`。
2. **能力必须逐项如实声明**。不同供应商的"OpenAI 兼容"程度不一样 ——
   图片理解、结构化输出、流式调用**逐项验证**，不支持就抛明确的错误，
   **绝不假装成功**。
3. **密钥只在服务端**。`src/lib/env.ts` 在客户端被导入时会直接抛错；
   密钥从不下发到浏览器。

---

## 2. 配置

```bash
# .env

# 三选一：mock（默认，无需密钥）| deepseek | openai-compatible
AI_PROVIDER=deepseek

# 端点与模型
AI_BASE_URL=https://api.deepseek.com     # 留空则用 provider 内置默认值
AI_MODEL=deepseek-chat                    # 留空则用 provider 内置默认值
AI_VISION_MODEL=                          # 支持图片理解的模型；留空 = 不具备图片理解能力
AI_API_KEY=sk-xxxxxxxx                    # ⚠️ 仅服务端读取，切勿提交到版本库

# 可靠性
AI_TIMEOUT_MS=30000                       # 单次调用超时
AI_MAX_RETRIES=2                          # 可重试错误的重试次数（指数退避 300/600/1200ms）
AI_MAX_INPUT_CHARS=24000                  # 输入长度上限（超出直接报错，不打到上游）
AI_MAX_OUTPUT_TOKENS=2048
AI_RATE_LIMIT_PER_MINUTE=20               # 每用户每分钟 AI 请求上限（按「用户 × 服务」分桶）
```

配置错误会在**启动时**被 Zod 拦下并说明缺哪个字段，不会出现"服务起来了但功能是坏的"：

```
[env] AI_PROVIDER=deepseek 需要 AI_API_KEY，但该变量为空。
      本地开发可先设为 AI_PROVIDER=mock（无需密钥）。
```

### 演示账号与密钥

演示账号 `demo@study.local` / `study-coach-2026` 的密码是**公开的固定值** ——
它只是本地体验用的示例账号，**不要**在任何暴露到公网的部署里保留它。
`.env.example` 里**不含任何真实密钥**。

---

## 3. Provider 能力矩阵

| 能力 | Mock | DeepSeek | openai-compatible |
|---|---|---|---|
| 文本生成 `generateText` | ✅ | ✅ | ✅ |
| 流式 `streamText` | ✅（由非流式分块回退） | ✅ 原生 SSE | ✅ 原生 SSE |
| 结构化输出 `generateStructured` | ✅（返回结构正确的空壳） | ✅ `response_format: json_object`，被拒时自动降级为提示词约束 | ✅ 同左 |
| 图片理解 `analyzeImage` | ⚠️ 声明支持但**只返回占位内容** | ⚠️ **取决于是否配置了 `AI_VISION_MODEL`**；`deepseek-chat` 不支持图片输入 | ⚠️ 取决于是否配置了 `AI_VISION_MODEL` |
| 模型列表查询 `getAvailableModels` | 内置列表 | 调 `GET /models`；失败时如实返回配置里的模型 | 同左 |

> ⚠️ **`deepseek-chat` 不能当视觉模型用**。要在 DeepSeek 上做图片识别，
> 必须把 `AI_VISION_MODEL` 指向真正支持视觉的模型；未配置时
> `analyzeImage()` 会抛 `AI_CAPABILITY_UNSUPPORTED`（501），界面会引导到手动录入，
> **不会**静默降级成假结果。

### 能力的真实性如何保证

`AbstractAiProvider` 在调用前检查 `getCapabilities()`，不满足就抛错。因此：

- 不支持视觉 → 501 + 提示"可以手动录入题目内容"
- 不支持结构化 → 若声明 `structuredFallback: 'none'` 则抛错
- provider 未配置密钥 → 503 + 提示如何配置

---

## 4. Mock 模式（没有 API Key 时）

`AI_PROVIDER=mock`（默认）时使用 `src/lib/ai/providers/mock.ts`：

- **不需要任何密钥**，可完全离线开发与测试
- 文本回复是一段**明确的说明**，会告诉你如何切换到真实模型
- 结构化输出返回**结构完全正确、但内容为空壳**的对象（`confidence: 0`）
- 图片识别返回 `needsUserConfirmation: true` + `confidence: 0`

> **最重要的设计约束**：Mock **刻意不生成**看起来像真答案的解题过程。
> 如果它编一段像模像样的解题步骤，用户会误以为那是正确解法 ——
> 这比"没有回答"更糟糕。所以 Mock 只负责把整条链路（提问 → 流式输出 →
> 落库 → 日志）跑通，并在界面上明确标注"演示/未接入真实模型"。

因此 **Mock 模式下不要评价"回答质量"** —— 那不是它的职责。

---

## 5. 真实 API 验收清单

> ✅ **当前状态：已于 2026-10-17 用真实 DeepSeek 密钥完成验收。**
>
> | 验收项 | 结果 | 实测证据 |
> |---|---|---|
> | 5.1 普通文本答疑 | ✅ 通过 | 一次生成 1100+ 字真实讲解，含 LaTeX 公式，未出现 Mock 文案 |
> | 5.2 多轮上下文 | ✅ 通过 | 追问 1193 字，内容与上一轮主题连贯；会话落库 4 条消息 |
> | 5.3 流式输出 | ✅ 通过 | `text/event-stream` + `no-transform`，逐块 delta，`[DONE]` 收尾 |
> | 5.4 结构化错题分析 | ✅ 通过 | 一次通过 Zod 校验，`confidence=0.92`，错误分类在枚举内 |
> | 5.4 知识点白名单 | ✅ 通过 | 命中 `MATH-G2-DERIV-03` / `MATH-G1-FUNC-02`，**编造并被丢弃 0 个** |
> | 5.5 图片理解 | ✅ 通过 | 渲染真实题目截图 → OCR 题干完全正确 → 解析正确（模型自我纠错 `f(-1)=4`） |
> | 5.6 输入长度限制 | ✅ 通过 | 4100 字输入被本地 400 拦截，未打到上游 |
> | 5.7 用量统计 | ✅ 通过 | `promptTokens=662 / completionTokens=4634`，来自上游真实返回 |
> | 5.8 红线检查 | ✅ 通过 | 未编造教材页码 / 视频链接 / 知识点编号 |
>
> 复现命令：
> ```bash
> node scripts/acceptance-ai.mjs          # 文本 / 多轮 / 流式 / 结构化 / 限制
> node scripts/acceptance-ai-vision.mjs    # 图片理解（自动渲染题目截图）
> ```
> 两项脚本均**不会打印密钥**。

### 5.0 前置

```bash
# 1) 只改本地 .env（不要把密钥写进任何会被提交的文件）
#    建议先复制一份 .env 备份，方便验收后切回 mock
cp .env .env.mock.bak

# 2) 填入真实配置
#    AI_PROVIDER=deepseek
#    AI_API_KEY=sk-你的密钥
#    AI_MODEL=deepseek-flash
#    AI_VISION_MODEL=deepseek-flash     # 该模型 input_modalities 含 image
#    AI_MAX_OUTPUT_TOKENS=8192          # ⚠️ 见下方"推理模型"说明

# 3) 重启服务（改环境变量必须重启）
npm run dev
```

### ⚠️ 推理模型的关键差异（实测踩坑记录）

`deepseek-flash`（DeepSeek-V4.1-Flash）是**推理模型**：它的流式响应里会先返回
`delta.reasoning_content`（思考过程），之后才是 `delta.content`（正式回答）。
两者**都计入 `max_tokens`**。

实测现象：`AI_MAX_OUTPUT_TOKENS=2048` 时，思考过程用光了全部预算，
`completionTokens=2048` 而正文长度为 **0** —— 学生看到一条空回复。

项目已做两处处理：

1. `openai-compatible.ts` 把 `reasoning_content` 解析为独立的 `reasoning` 分块：
   **不混进答案**（思考草稿不是答案），但单独计数（它真实占用预算）。
2. `provider.ts` 在「正文为空 + 有思考内容 + finishReason=length」时
   **明确报错**并提示调大 `AI_MAX_OUTPUT_TOKENS`，而不是返回空回复。

使用推理模型时请把 `AI_MAX_OUTPUT_TOKENS` 设为 **≥ 8192**。
`deepseek-v4-pro` 同属这一代模型，规则相同。

验证配置是否被正确加载（**只报告状态，不回显密钥**）：

```bash
curl -s http://localhost:3000/api/health | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d).data;console.log('provider:',j.ai.provider,'| 真实provider:',j.ai.isRealProvider,'| 已配置Key:',j.config.aiConfigured,'| 视觉模型:',j.ai.visionModel||'（未配置）')})"
```

预期：`provider: deepseek | 真实provider: true | 已配置Key: true`

### 5.1 普通文本答疑 ✅ 待执行

```bash
curl -N -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -b .data/cookies-demo.txt \
  -d '{"message":"什么是函数的单调性？请用高中生能懂的话解释。","mode":"detailed"}'
```

- [ ] 返回的 `type: "delta"` 里是**真实解题讲解**，不再是 Mock 说明
- [ ] 讲解符合高中课程水平（不出现大学/竞赛术语）
- [ ] 公式用 LaTeX（`$...$` / `$$...$$`）
- [ ] 回复末尾给出 1–3 道巩固练习
- [ ] **没有**编造教材页码、视频链接、知识点编号

### 5.2 多轮上下文 ✅ 待执行

- [ ] 第一轮提问后，用返回的 `conversationId` 再问一句「上面那一步再讲细一点」，
      模型能**引用上一轮内容**（说明上下文拼接生效）
- [ ] `GET /api/conversations/[id]` 能看到两条提问 + 两条回复，顺序正确

### 5.3 流式输出 ✅ 待执行

- [ ] 响应头是 `text/event-stream; charset=utf-8`，且有 `Cache-Control: no-cache, no-transform`
- [ ] 逐块到达（不是一次性返回全部）
- [ ] 最后以 `data: [DONE]` 结束
- [ ] **中途断开连接**（`Ctrl+C`）后，服务端日志显示请求被中止，
      且上游不会继续生成（检查 `ModelCallLog` 的 `latencyMs` 没有异常拉长）

### 5.4 结构化错题分析 ✅ 待执行

```bash
curl -s -X POST http://localhost:3000/api/questions/analyze \
  -H "Content-Type: application/json" -b .data/cookies-demo.txt \
  -d '{"stem":"已知函数 f(x)=x^3-3ax+1，讨论 a 的取值对 f(x) 单调性的影响。","studentAnswer":"f′(x)=3x^2-3a>0 解得 x>√a","subjectId":"math","createMistake":false}'
```

- [ ] 返回的 `analysis` 通过运行时 Zod 校验（否则会返回 502 `AI_INVALID_OUTPUT` 并重试）
- [ ] `knowledgePoints` 里的 code **全部存在于目录中**；
      若模型编造了不存在的编码，它们会出现在 `rejectedKnowledgePointCodes` 里（服务层已丢弃）
- [ ] `errorTypes` 是合法的分类代码（可能为空数组）
- [ ] `confidence` 是 0–1 之间的小数
- [ ] 题干残缺时 `needsUserConfirmation` 为 `true`（可以故意传一个空 `stem` 试）

### 5.5 图片理解 ⚠️ 仅在模型确实支持时

- [ ] 上传一张清晰的题目截图，`POST /api/questions/analyze` 带上 `uploadId`
- [ ] 识别出的题干与图片一致；**图片模糊时应返回 `needsUserConfirmation: true`，
      而不是编造题目内容**
- [ ] 若模型不支持视觉：应返回 **501** `AI_CAPABILITY_UNSUPPORTED`，
      界面给出"可手动录入"的引导（这是**正确行为**，不是缺陷）

### 5.6 超时 / 限流 / 鉴权失败 ✅ 待执行

- [ ] **超时**：把 `AI_TIMEOUT_MS` 改成 `1` 后重启，提问应返回 504 `AI_TIMEOUT`，
      提示"可以稍后再试，或把问题拆小一点"
- [ ] **鉴权失败**：把 `AI_API_KEY` 改成错误值，应返回 503 `AI_NOT_CONFIGURED`
      且提示"密钥无效或已过期"；**响应里不得出现密钥本身**
- [ ] **限流（上游 429）**：如果上游返回 429，应映射为 429 `RATE_LIMITED`
- [ ] **本项目自身的限流**：把 `AI_RATE_LIMIT_PER_MINUTE` 设为 `2`，
      连续发 3 次提问，第 3 次应返回 429 并告知等待秒数
- [ ] **输入过长**：发送超过 `AI_MAX_INPUT_CHARS` 的内容，应返回 400 且提示拆分问题
      （**不能**打到上游再失败）

### 5.7 成本与可观测性 ✅ 待执行

- [ ] `ModelCallLog` 表里能看到 `provider` / `model` / `status` / `latencyMs` /
      `promptChars` / `completionChars` / `retryCount`
- [ ] **确认日志里没有提示词正文、没有密钥、没有学生答案原文**
- [ ] 上游返回用量时 `promptTokens` / `completionTokens` 有值；
      拿不到时为 `null`（**不估算假数据**）
- [ ] `estimatedCostUsd` 只有在供应商真的返回费用时才有值

### 5.8 验收后

```bash
cp .env.mock.bak .env   # 切回 mock 配置
npm run dev
```

并把验收结果（每项的 ✅/❌ 与证据）记录到 `docs/ACCEPTANCE.md`。
**未实际执行的项目请如实标注为"未验证"。**

---

## 6. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动报 `AI_PROVIDER=deepseek 需要 AI_API_KEY` | 选了真实 provider 但没填 Key | 填 Key，或先改回 `AI_PROVIDER=mock` |
| 启动报 `AI_PROVIDER=openai-compatible 需要同时设置 AI_BASE_URL` | 缺端点 | 填 `AI_BASE_URL` |
| 报 503 且提示"密钥无效或已过期" | 上游 401/403 | 检查 Key 是否过期、是否有额度 |
| 报 502 `AI_UPSTREAM_ERROR` | 上游 5xx / 网络 | 会自动退避重试；仍失败看上游状态页 |
| 报 502 且提示"返回的内容格式不符合要求" | 结构化输出校验失败（重试后仍失败） | 换更大的模型，或降低 `AI_MAX_OUTPUT_TOKENS` 之外的温度设置 |
| 报 504 `AI_TIMEOUT` | 问题太长或上游慢 | 调大 `AI_TIMEOUT_MS`，或把问题拆小 |
| 图片识别报 501 | 未配置 `AI_VISION_MODEL`，或该模型不支持图片 | 配置视觉模型，或改用手动录入（**手动录入同样有完整分析**） |
| 报 429 "提问有点快啦" | 触发本项目限流 | 等提示的秒数；或调整 `AI_RATE_LIMIT_PER_MINUTE` |
| 回复内容里出现不存在的知识点编号 | 模型幻觉 | **已被服务层丢弃**（见 `rejectedKnowledgePointCodes`）；如频繁出现，请在提示词里强化约束 |
| 界面一直显示"Mock 模式" | 仍是 `AI_PROVIDER=mock` | 按第 2 节配置后**重启**服务（环境变量不会热更新） |

---

## 7. 扩展新的 Provider

1. 在 `src/lib/ai/providers/` 新建文件，继承 `AbstractAiProvider`
2. 实现 `declareCapabilities()` 与四个 `raw*` 方法
   （`rawGenerateText` / `rawGenerateJson`（可选）/ `rawAnalyzeImage` / `rawStreamText`（可选））
3. 在 `src/lib/ai/registry.ts` 的 `createProviderFromEnv()` 里注册
4. 基类会自动接管：能力校验、输入长度限制、超时、重试退避、结构化校验与修复重试、调用日志

**不需要**在子类里重复实现这些通用关切。
