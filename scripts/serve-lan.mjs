#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * 把本机当作服务器启动（局域网 / 内网穿透都从这一步开始）。
 *
 * 与 `npm run dev` 的区别：
 *   1. 跑的是 `next start`（生产构建），而不是开发服务器 ——
 *      开发服务器单线程编译、按需打包，手机连着用会明显卡顿，也不该长期暴露在网络上。
 *   2. 监听 0.0.0.0，手机才能通过局域网 IP 访问（默认只监听 localhost）。
 *   3. 启动前做一次配置自检：Cookie 安全策略、注册开关、密钥强度、
 *      构建产物是否存在 —— 这些配错了不会报错，只会「登录成功但存不住」这类诡异现象。
 *
 * 为什么不在脚本里直接构建：
 *   构建要几十秒到几分钟，和"启动服务"是两件事。分开更好排错，
 *   也让「重新部署」只需要改一次代码、构建一次、重启一次。
 */

const ROOT = process.cwd();

// -----------------------------------------------------------------------------
// 极简 .env 解析（只用于启动前的自检提示，真正加载由 Next 自己做）
// -----------------------------------------------------------------------------
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  const values = {};
  if (!existsSync(file)) return values;

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const env = { ...loadEnvFile(), ...process.env };

const PORT = Number(env.PORT || 3100);

/**
 * 监听地址。
 *
 * 用 `::`（IPv6 通配）而不是 `0.0.0.0`：在这个环境下实测 `::` 是**双栈**的，
 * netstat 会同时出现 0.0.0.0:3100 与 [::]:3100，IPv4 与 IPv6 客户端都能连。
 * 这一点很关键 —— 国内家宽普遍没有公网 IPv4，但往往有公网 IPv6，
 * 只绑 0.0.0.0 的话 IPv6 直连方案完全不可用。
 *
 * 万一某台机器上双栈有问题（个别旧网卡驱动），可以用 BIND_HOST=0.0.0.0 退回纯 IPv4。
 */
const HOST = env.BIND_HOST || '::';

// -----------------------------------------------------------------------------
// 网络地址
// -----------------------------------------------------------------------------

/** Tailscale（以及同类 WireGuard 组网）使用 100.64.0.0/10 这个保留网段 */
function isTailscaleAddress(address) {
  const [first, second] = address.split('.').map(Number);
  return first === 100 && second >= 64 && second <= 127;
}

function networkAddresses() {
  const local = [];
  const remote = [];
  const ipv6 = [];

  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.internal) continue;

      if (info.family === 'IPv6') {
        // fe80:: 是链路本地地址，出了本网段就没用
        if (!info.address.toLowerCase().startsWith('fe80')) ipv6.push({ name, address: info.address });
        continue;
      }

      if (info.family !== 'IPv4') continue;
      // 169.254.x.x 是没拿到 DHCP 时的自动地址，连不通
      if (info.address.startsWith('169.254.')) continue;
      (isTailscaleAddress(info.address) ? remote : local).push({ name, address: info.address });
    }
  }

  // 常见的家庭/校园网段排前面，方便一眼找到该用哪个
  const score = (ip) =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3;
  local.sort((a, b) => score(a.address) - score(b.address));

  return { local, remote, ipv6 };
}


// -----------------------------------------------------------------------------
// 配置自检
// -----------------------------------------------------------------------------
function resolveCookieSecure(values) {
  if (values.COOKIE_SECURE === 'true') return true;
  if (values.COOKIE_SECURE === 'false') return false;
  return String(values.APP_URL ?? '').startsWith('https://');
}

function preflight() {
  const problems = [];
  const warnings = [];
  const notes = [];

  // 1) 有没有生产构建
  const buildIdFile = path.join(ROOT, '.next', 'BUILD_ID');
  if (!existsSync(buildIdFile)) {
    problems.push(
      '还没做生产构建（找不到 .next/BUILD_ID）。先运行：npm run build',
    );
  } else {
    const ageMinutes = (Date.now() - statSync(buildIdFile).mtimeMs) / 60000;
    if (ageMinutes > 60 * 24 * 7) {
      notes.push(
        `当前构建产物是 ${Math.round(ageMinutes / 60 / 24)} 天前生成的；改过代码的话记得重新 npm run build`,
      );
    }
  }

  // 2) Cookie Secure —— 配错会导致「登录成功但刷新又回登录页」
  const cookieSecure = resolveCookieSecure(env);
  const appUrl = String(env.APP_URL ?? '');
  if (cookieSecure && !appUrl.startsWith('https://')) {
    problems.push(
      `COOKIE_SECURE 解析为 true，但 APP_URL 是 ${appUrl || '(未设置)'}。` +
        '用 http 访问时浏览器不会回传 Cookie，登录状态存不住。' +
        '请把 COOKIE_SECURE 设为 auto（且 APP_URL 用 http://...）或直接设为 false。',
    );
  }

  // 3) 会话密钥
  const secret = String(env.SESSION_SECRET ?? '');
  if (secret.length < 32) {
    problems.push('SESSION_SECRET 少于 32 个字符，会话签名强度不足。请重新生成一个长随机串。');
  }

  // 4) 自助注册
  if (String(env.ALLOW_SELF_SIGNUP ?? 'true') === 'true') {
    warnings.push(
      'ALLOW_SELF_SIGNUP=true：同一网络下任何人都能注册账号。' +
        '账号建好后建议在 .env 改为 false 并重启。',
    );
  }

  // 5) 演示账号
  notes.push(
    '如果还留着演示账号 demo@study.local（密码是公开的），在给别人用之前务必删掉或改密。',
  );

  // 6) AI 配置
  if (String(env.AI_PROVIDER ?? 'mock') === 'mock') {
    notes.push('AI_PROVIDER=mock：当前 AI 回复是示例结构，不是真实讲解。');
  }

  return { problems, warnings, notes, cookieSecure };
}

// -----------------------------------------------------------------------------
// 启动
// -----------------------------------------------------------------------------
function start() {
  const { problems, warnings, notes, cookieSecure } = preflight();
  const { local, remote, ipv6 } = networkAddresses();

  console.log('');
  console.log('  AI 高中学习教练 · 服务启动');
  console.log('  ────────────────────────────────────────────');
  console.log(`  监听地址   ${HOST}:${PORT}   （:: = 双栈，IPv4 与 IPv6 都监听）`);
  console.log(`  本机访问   http://localhost:${PORT}`);

  if (local.length === 0) {
    console.log('  同一 Wi-Fi   未探测到局域网 IP（检查是否连着 Wi-Fi）');
  } else {
    for (const item of local) {
      console.log(`  同一 Wi-Fi   http://${item.address}:${PORT}   (${item.name})`);
    }
  }

  if (remote.length > 0) {
    for (const item of remote) {
      console.log(`  异地访问   http://${item.address}:${PORT}   (${item.name} · 已通过 Tailscale 组网)`);
    }
  } else {
    console.log('  异地访问   未检测到 Tailscale —— 想在别处的手机上用，见 docs/REMOTE_ACCESS.md');
  }

  if (ipv6.length > 0) {
    for (const item of ipv6) {
      console.log(`  IPv6 直连  http://[${item.address}]:${PORT}   (${item.name} · 需路由器放行)`);
    }
  }

  console.log(`  Cookie 安全标记   ${cookieSecure ? 'Secure（仅 HTTPS 可用）' : '不加密（HTTP 可正常登录）'}`);
  console.log('  ────────────────────────────────────────────');

  if (warnings.length) {
    console.log('\n  ⚠️ 提示');
    for (const item of warnings) console.log(`     · ${item}`);
  }
  if (notes.length) {
    console.log('\n  ℹ️ 说明');
    for (const item of notes) console.log(`     · ${item}`);
  }

  if (problems.length) {
    console.log('\n  ❌ 配置有问题，已中止启动');
    for (const item of problems) console.log(`     · ${item}`);
    console.log('');
    process.exit(1);
  }

  console.log('\n  同一 Wi-Fi：在手机浏览器输入上面「同一 Wi-Fi」那一行的地址即可。');
  console.log('  异地使用：装 Tailscale 后，用「异地访问」那一行的地址（不用改路由器、不暴露公网）。');
  console.log('  防火墙没放行会导致手机连不上 —— 见 docs/LAN_DEPLOY.md 第 1 节。');
  console.log('  按 Ctrl+C 停止服务。\n');

  // 直接跑 next 的可执行入口，避免依赖 npx 的 shell 行为（Windows 上尤其容易踩坑）
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, 'start', '-H', HOST, '-p', String(PORT)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  const shutdown = (signal) => {
    child.kill(signal);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 0));
}

start();
