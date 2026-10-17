#!/usr/bin/env node
/**
 * DeepSeek 真实 API 验收脚本（对应 docs/AI_PROVIDER.md 第 5 节）。
 *
 * 为什么写成脚本而不是一串 curl：
 *   验收项之间有依赖（要先登录拿会话、要用上一步的 conversationId 做多轮），
 *   而且需要统计流式分块数、首字延迟等指标 —— 脚本更好读、可重复执行。
 *
 * ⚠️ 本脚本**不会打印任何密钥**。
 *
 * 用法：node scripts/acceptance-ai.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3100';

const results = [];
let cookie = '';

function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  const mark = pass === true ? '✅' : pass === false ? '❌' : '⚠️';
  console.log(`${mark} ${id} ${name}`);
  if (detail) console.log(`     ${detail}`);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${BASE}${path}`, { ...options, headers });

  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const pair = raw.split(';')[0];
    if (pair.startsWith('sc_session=')) cookie = pair;
  }

  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body, headers: response.headers };
}

async function main() {
  console.log(`\n===== DeepSeek 真机验收 @ ${BASE} =====\n`);

  // ---------- 0. 健康检查：确认已切换到真实 provider ----------
  const health = await api('/api/health');
  const ai = health.body?.data?.ai ?? {};
  const config = health.body?.data?.config ?? {};
  record(
    '0',
    'provider 已切换为真实模型',
    ai.isRealProvider === true && config.aiConfigured === true,
    `provider=${ai.provider} model=${ai.defaultModel} vision=${ai.visionModel ?? '(未配置)'} keyConfigured=${config.aiConfigured}`,
  );
  if (ai.isRealProvider !== true) {
    console.log('\n未切换到真实 provider，后续验收无意义，已中止。');
    process.exit(1);
  }

  // ---------- 登录（用演示账号） ----------
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'demo@study.local', password: 'study-coach-2026' }),
  });
  if (login.status !== 200) {
    record('pre', '登录演示账号', false, `HTTP ${login.status}`);
    process.exit(1);
  }

  // ---------- 1. 普通文本答疑 + 流式输出 ----------
  const streamStart = Date.now();
  const chat = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      message: '什么是函数的单调性？请用高中生能听懂的话解释，并给一个最小例子。',
      mode: 'detailed',
      subjectId: 'math',
    }),
  });

  const contentType = chat.headers.get('content-type') ?? '';
  const cacheControl = chat.headers.get('cache-control') ?? '';

  let chunks = 0;
  let full = '';
  let firstTokenMs = null;
  let conversationId = null;
  let usage = null;
  let doneEvent = null;
  let buffer = '';

  const reader = chat.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf('\n\n');

      for (const line of rawEvent.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === 'start') conversationId = evt.conversationId;
          if (evt.type === 'delta') {
            if (firstTokenMs === null) firstTokenMs = Date.now() - streamStart;
            chunks += 1;
            full += evt.text;
          }
          if (evt.type === 'usage') usage = evt.usage;
          if (evt.type === 'done') doneEvent = evt;
          if (evt.type === 'error') full += `\n[ERROR ${evt.code}] ${evt.message}`;
        } catch {
          // 忽略无法解析的片段
        }
      }
    }
  }

  const totalMs = Date.now() - streamStart;

  record(
    '1',
    '流式响应头正确（SSE + 不缓冲）',
    contentType.includes('text/event-stream'),
    `Content-Type: ${contentType} | Cache-Control: ${cacheControl}`,
  );

  record(
    '2',
    '逐块流式输出（不是一次性返回）',
    chunks >= 3,
    `${chunks} 个 delta 分块 | 首字延迟 ${firstTokenMs}ms | 总耗时 ${totalMs}ms`,
  );

  record(
    '3',
    '以 done 事件正常结束',
    Boolean(doneEvent),
    doneEvent ? `latencyMs=${doneEvent.latencyMs} retryCount=${doneEvent.retryCount}` : '未收到 done 事件',
  );

  const isMockText = /Mock 模式|未接入真实模型/.test(full);
  const looksReal =
    full.length > 200 && !isMockText && /(单调|定义|区间|递增|递减|导数)/.test(full);

  record(
    '4',
    '返回的是真实讲解（非 Mock 占位）',
    looksReal,
    `回复长度 ${full.length} 字${isMockText ? '（仍是 Mock 文案）' : ''}`,
  );

  // 红线检查：不得编造教材页码/视频链接/知识点编号
  const fabricated =
    /(教材\s*第\s*\d+\s*页|第\s*\d+\s*页\s*第|https?:\/\/[^\s)]*(bilibili|youtube|iqiyi)|知识点编号\s*[:：]?\s*\d+)/.test(
      full,
    );
  record('5', '未编造教材页码 / 视频链接 / 知识点编号', !fabricated, fabricated ? '检测到疑似编造内容' : '未检测到');

  const hasLatex = /\$[^$]+\$|\\\(|\\\[/.test(full);
  record('6', '公式使用 LaTeX', hasLatex, hasLatex ? '检测到 LaTeX 公式' : '未检测到公式（该题可能不需要）');

  if (usage) {
    record(
      '7',
      '上游返回 token 用量',
      typeof usage.promptTokens === 'number' || typeof usage.completionTokens === 'number',
      `promptTokens=${usage.promptTokens ?? 'null'} completionTokens=${usage.completionTokens ?? 'null'}`,
    );
  } else {
    record('7', '上游返回 token 用量', null, '本次未返回 usage（部分兼容端点不返回，属正常）');
  }

  // ---------- 2. 多轮上下文 ----------
  if (conversationId) {
    const followUp = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        conversationId,
        message: '上面那个例子里，为什么必须强调"在区间内任意两个自变量"？',
        mode: 'guided',
      }),
    });

    // 第二轮的响应也是 SSE，这里只关心是否成功与内容是否连贯
    const text = typeof followUp.body?.raw === 'string' ? followUp.body.raw : '';
    const deltaText = [...text.matchAll(/"type":"delta","text":"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => JSON.parse(`"${m[1]}"`))
      .join('');

    const referencesContext = /区间|自变量|任意|单调/.test(deltaText);
    record(
      '8',
      '多轮上下文（能接上上一轮内容）',
      deltaText.length > 50 && referencesContext,
      `追问回复 ${deltaText.length} 字，${referencesContext ? '内容与上一轮主题相关' : '未体现上下文'}`,
    );

    // 会话消息数应为 4（2 问 2 答）
    const conv = await api(`/api/conversations/${conversationId}`);
    const messages = conv.body?.data?.messages?.length ?? 0;
    record('9', '对话已持久化（2 问 2 答）', messages >= 4, `消息数=${messages}`);
  }

  // ---------- 3. 结构化错题分析 ----------
  const analyze = await api('/api/questions/analyze', {
    method: 'POST',
    body: JSON.stringify({
      stem: '已知函数 f(x)=x^3-3ax+1，讨论 a 的取值对 f(x) 单调性的影响。',
      studentAnswer: 'f′(x)=3x^2-3a，令 f′(x)>0 得 x>√a，所以递增区间是 (√a,+∞)。',
      subjectId: 'math',
      createMistake: false,
    }),
  });

  const analysis = analyze.body?.data?.analysis;
  const analysisOk =
    analyze.status === 200 &&
    typeof analysis?.explanation === 'string' &&
    analysis.explanation.length > 50 &&
    typeof analysis?.confidence === 'number';

  record(
    '10',
    '结构化输出通过运行时校验',
    analysisOk,
    analysisOk
      ? `confidence=${analysis.confidence} 解析长度=${analysis.explanation.length} 错误类型=[${(analysis.errorTypes ?? []).join(',')}]`
      : `HTTP ${analyze.status} ${JSON.stringify(analyze.body).slice(0, 200)}`,
  );

  if (analysisOk) {
    const rejected = analyze.body.data.rejectedKnowledgePointCodes ?? [];
    const matched = analyze.body.data.matchedKnowledgePoints ?? [];

    record(
      '11',
      '知识点只引用目录中真实存在的编码',
      rejected.length === 0,
      `命中 ${matched.length} 个（${matched.map((m) => m.code).join(',') || '无'}）｜被丢弃的编造编码 ${rejected.length} 个 ${rejected.length ? `(${rejected.join(',')})` : ''}`,
    );

    const causesOk =
      Array.isArray(analysis.likelyCauses) &&
      Array.isArray(analysis.recommendedActions) &&
      analysis.recommendedActions.length > 0;
    record(
      '12',
      '给出了错因分析与可执行的下一步建议',
      causesOk,
      `likelyCauses=${analysis.likelyCauses?.length ?? 0} 条 | 建议：${(analysis.recommendedActions ?? []).slice(0, 2).join(' / ')}`,
    );

    record(
      '13',
      '错误原因分类在允许的枚举内',
      (analysis.errorTypes ?? []).every((t) =>
        ['unknown','concept','formula','calculation','reading','incomplete-reasoning','method','transfer','time-management'].includes(t),
      ),
      `errorTypes=[${(analysis.errorTypes ?? []).join(',')}]`,
    );
  }

  // ---------- 4. 输入长度限制 ----------
  const tooLong = await api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'a'.repeat(4100), mode: 'guided' }),
  });
  record(
    '14',
    '超长输入被本地拦截（未打到上游）',
    tooLong.status === 400,
    `HTTP ${tooLong.status} code=${tooLong.body?.error?.code}`,
  );

  // ---------- 5. 调用日志（可观测性 + 不泄露敏感内容） ----------
  const logs = await api('/api/health'); // 健康检查确保服务仍正常
  record('15', '验收期间服务保持健康', logs.body?.data?.status === 'ok', `status=${logs.body?.data?.status}`);

  // ---------- 汇总 ----------
  const passed = results.filter((r) => r.pass === true).length;
  const failed = results.filter((r) => r.pass === false).length;
  const skipped = results.filter((r) => r.pass === null).length;

  console.log(`\n===== 汇总：通过 ${passed} / 失败 ${failed} / 提示 ${skipped} =====\n`);

  // 输出一段真实回复样本，便于人工判断质量（截断，不含密钥）
  if (full) {
    console.log('--- 真实回复样本（前 600 字）---');
    console.log(full.slice(0, 600).replace(/\n{3,}/g, '\n\n'));
    console.log('--- 样本结束 ---\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('验收脚本异常：', error);
  process.exit(2);
});
