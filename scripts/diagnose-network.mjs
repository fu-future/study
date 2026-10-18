#!/usr/bin/env node
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';

/**
 * 网络自检：异地访问连不上时，先用它把"卡在哪一层"定位清楚。
 *
 * 检查顺序对应真实的连接路径：
 *   1. 服务有没有在监听（本机）
 *   2. 局域网地址能不能连（同一 Wi-Fi）
 *   3. 有没有可用的异地通道（Tailscale / 公网 IPv6）
 *   4. 端口在公网上是否可达（只能判断"本机视角"，外部仍可能被运营商/路由器拦）
 */

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 3100);

const ok = (message) => console.log(`  ✅ ${message}`);
const bad = (message) => console.log(`  ❌ ${message}`);
const info = (message) => console.log(`  ℹ️  ${message}`);

function isTailscaleAddress(address) {
  const [first, second] = address.split('.').map(Number);
  return first === 100 && second >= 64 && second <= 127;
}

function collectAddresses() {
  const local = [];
  const tailscale = [];
  const ipv6 = [];

  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.internal) continue;
      if (entry.family === 'IPv4') {
        if (entry.address.startsWith('169.254.')) continue;
        (isTailscaleAddress(entry.address) ? tailscale : local).push({ name, address: entry.address });
      } else if (entry.family === 'IPv6') {
        // fe80:: 是链路本地地址，不能跨网段使用
        if (entry.address.toLowerCase().startsWith('fe80')) continue;
        ipv6.push({ name, address: entry.address });
      }
    }
  }

  return { local, tailscale, ipv6 };
}

function probe(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (okFlag) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(okFlag);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function tailscaleStatus() {
  const candidates = [
    'tailscale',
    'C:/Program Files/Tailscale/tailscale.exe',
    'C:/Program Files (x86)/Tailscale/tailscale.exe',
  ];
  for (const candidate of candidates) {
    if (candidate.includes('/') && !existsSync(candidate)) continue;
    try {
      const { stdout } = await execFileAsync(candidate, ['status'], { timeout: 8000 });
      return stdout.trim();
    } catch {
      // 继续尝试下一个路径
    }
  }
  return null;
}

async function main() {
  console.log('');
  console.log('  网络自检');
  console.log('  ════════════════════════════════════════════');

  // 1) 本机监听
  console.log('\n[1] 服务监听');
  const listening = await probe('127.0.0.1', PORT);
  if (listening) {
    ok(`127.0.0.1:${PORT} 可连接`);
  } else {
    bad(`127.0.0.1:${PORT} 连不上 —— 服务没启动？先运行 npm run lan`);
  }

  // 2) 局域网
  const { local, tailscale, ipv6 } = collectAddresses();
  console.log('\n[2] 局域网（同一 Wi-Fi 的手机用这个）');
  if (local.length === 0) {
    bad('没有局域网 IPv4 地址（电脑没连 Wi-Fi / 网线？）');
  } else {
    for (const item of local) {
      const reachable = await probe(item.address, PORT);
      (reachable ? ok : bad)(
        `http://${item.address}:${PORT}  (${item.name})${reachable ? '' : ' —— 端口不可达'}`,
      );
    }
  }
  if (local.length > 0 && !listening) info('局域网地址能连上，但本机回环连不上，通常是防火墙规则的方向问题');

  // 3) 异地通道
  console.log('\n[3] 异地访问通道');
  const status = await tailscaleStatus();
  if (tailscale.length > 0) {
    for (const item of tailscale) ok(`Tailscale 已就绪：http://${item.address}:${PORT}  (${item.name})`);
    if (status) {
      const firstLine = status.split('\n')[0];
      info(`tailscale status: ${firstLine}`);
    }
  } else if (status === null) {
    info('未安装 Tailscale —— 这是当前最省事的异地方案，见 docs/REMOTE_ACCESS.md');
  } else {
    info('Tailscale 已安装但未拿到 100.x 地址 —— 可能没登录或没连上，执行 tailscale up');
  }

  if (ipv6.length > 0) {
    for (const item of ipv6) {
      info(`公网 IPv6：http://[${item.address}]:${PORT}  (${item.name})`);
    }
    info('IPv6 只有在"手机所在网络也支持 IPv6"时才连得通，且前缀可能随重连变化');
  } else {
    info('没有公网 IPv6，IPv6 直连方案不可用');
  }

  // 4) 结论
  console.log('\n[4] 结论');
  if (!listening) {
    bad('先解决第一步：服务没起来，后面都不用看。');
  } else if (local.length > 0) {
    ok('同一 Wi-Fi 下应当已经可用（防火墙若未放行，见 docs/LAN_DEPLOY.md 第 1 节）');
    if (tailscale.length > 0) ok('异地访问也已可用：手机装上 Tailscale 并登录同一账号即可');
    else info('异地访问需要额外通道，按 docs/REMOTE_ACCESS.md 选一个方案');
  }
  console.log('');
}

await main();
