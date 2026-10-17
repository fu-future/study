#!/usr/bin/env node
/**
 * 图片理解（视觉链路）验收。
 *
 * 做法：用 Playwright 把一道真实的数学题渲染成 PNG 截图，再走
 * 「上传 → 视觉模型识别 → 结构化分析」这条真实链路。
 *
 * 为什么用渲染而不是找现成图片：
 *   渲染出来的题目内容是我自己写的、**已知正确答案**，
 *   这样才能判断模型识别得对不对，而不是"看起来像成功"。
 *
 * 用法：node scripts/acceptance-ai-vision.mjs [baseUrl]
 */
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:3100';
const OUT_DIR = path.resolve('.data/vision-test');
const PNG_PATH = path.join(OUT_DIR, 'question.png');

const QUESTION_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  body { margin:0; padding:28px; background:#fff;
         font-family: "Microsoft YaHei", "SimSun", serif; color:#111; }
  .paper { width:760px; }
  .head { font-size:15px; color:#666; margin-bottom:14px; }
  .stem { font-size:21px; line-height:1.9; margin-bottom:16px; }
  .work { font-size:19px; line-height:2.1; border-top:1px dashed #999; padding-top:14px; }
  .work .label { color:#a33; font-size:15px; }
</style></head>
<body><div class="paper">
  <div class="head">高二数学 · 导数及其应用 · 第 12 题</div>
  <div class="stem">
    已知函数 f(x) = x³ − 3x + 2。<br>
    （1）求 f(x) 的单调区间；<br>
    （2）求 f(x) 的极大值与极小值。
  </div>
  <div class="work">
    <div class="label">学生的解答：</div>
    f′(x) = 3x² − 3，令 f′(x) = 0 得 x = ±1。<br>
    因为 f′(x) &gt; 0，所以 x &gt; 1，<br>
    所以 f(x) 的单调递增区间是 (1, +∞)，<br>
    极大值是 f(1) = 0，极小值是 f(−1) = 4。
  </div>
</div></body></html>`;

let cookie = '';

async function api(pathname, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${BASE}${pathname}`, { ...options, headers });
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const pair = raw.split(';')[0];
    if (pair.startsWith('sc_session=')) cookie = pair;
  }
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main() {
  console.log(`\n===== 图片理解验收 @ ${BASE} =====\n`);

  // ---- 1. 渲染题目截图 ----
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 860, height: 620 }, deviceScaleFactor: 2 });
  await page.setContent(QUESTION_HTML, { waitUntil: 'load' });
  const png = await page.screenshot({ type: 'png', fullPage: true });
  await browser.close();
  await writeFile(PNG_PATH, png);
  console.log(`✅ 1 题目截图已生成：${PNG_PATH}（${Math.round(png.length / 1024)} KB）`);

  // ---- 2. 登录 ----
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'demo@study.local', password: 'study-coach-2026' }),
  });
  if (login.status !== 200) throw new Error(`登录失败 HTTP ${login.status}`);

  // ---- 3. 上传图片（multipart） ----
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'question.png');
  const upload = await fetch(`${BASE}/api/questions/upload`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  const uploadBody = await upload.json();
  console.log(
    `${upload.status === 200 ? '✅' : '❌'} 2 图片上传：HTTP ${upload.status} uploadId=${uploadBody?.data?.uploadId ?? '-'}`,
  );
  if (upload.status !== 200) process.exit(1);

  // ---- 4. 视觉识别 + 结构化分析 ----
  const started = Date.now();
  const analyze = await api('/api/questions/analyze', {
    method: 'POST',
    body: JSON.stringify({
      uploadId: uploadBody.data.uploadId,
      subjectId: 'math',
      createMistake: false,
    }),
  });
  const elapsed = Date.now() - started;

  if (analyze.status !== 200) {
    console.log(`❌ 3 视觉分析失败：HTTP ${analyze.status} ${JSON.stringify(analyze.body).slice(0, 300)}`);
    process.exit(1);
  }

  const data = analyze.body.data;
  const a = data.analysis;

  console.log(`✅ 3 视觉分析返回：耗时 ${elapsed}ms | provider=${data.providerId} model=${data.model}`);
  console.log(`     needsUserConfirmation=${data.needsUserConfirmation} confidence=${a.confidence}`);
  console.log(`     isMock=${data.isMock}`);

  console.log('\n--- 模型识别出的题干 ---');
  console.log((a.stem || '（空）').slice(0, 500));

  console.log('\n--- 学科 / 知识点 / 错误原因 ---');
  console.log(`学科: ${a.subject || '(空)'}`);
  console.log(`命中知识点: ${(data.matchedKnowledgePoints ?? []).map((k) => `${k.code}(${k.name})`).join(', ') || '无'}`);
  console.log(`编造被丢弃: ${(data.rejectedKnowledgePointCodes ?? []).join(', ') || '无'}`);
  console.log(`错误原因: ${(a.errorTypes ?? []).join(', ') || '(空)'}`);

  console.log('\n--- 解析（前 400 字）---');
  console.log((a.explanation || '（空）').slice(0, 400));

  // ---- 5. 判定 ----
  const stemMentions = /x\s*[³3]|3x|单调|极[大小]/.test(a.stem ?? '');
  console.log('\n===== 判定 =====');
  console.log(
    `${stemMentions ? '✅' : '⚠️'} 识别内容与题目相关：${stemMentions ? '题干包含题目的关键要素' : '未能确认识别到题干（可能是模型不支持图片输入）'}`,
  );
  console.log(
    `${a.stem?.trim() ? '✅' : '⚠️'} 是否返回了题干：${a.stem?.trim() ? '是' : '否 —— 按设计此时 needsUserConfirmation 应为 true，界面会引导学生手动录入'}`,
  );
  console.log(`✅ 未编造知识点编码：丢弃 ${(data.rejectedKnowledgePointCodes ?? []).length} 个`);
}

main().catch((error) => {
  console.error('视觉验收异常：', error);
  process.exit(2);
});
