/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 允许通过环境变量切换构建目录。
  // 用途：E2E 测试会在 3300 端口另起一个服务实例，
  // 如果和开发服务器共用 `.next`，两边会互相覆盖构建产物导致诡异报错。
  // 因此 E2E 使用独立的 `.next-e2e`，彼此隔离。
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // 题目图片保存在 .data/uploads（不在 public 下），只能通过带鉴权的 /api/files/[id] 读取。
  // 这样即使文件名泄漏，未授权用户也无法直接访问。
  experimental: {
    serverActions: {
      // 题目图片上传走 route handler，这里同时限制 Server Action 体积，避免大文件打满内存。
      bodySizeLimit: '8mb',
    },
  },
  eslint: {
    dirs: ['src', 'prisma', 'scripts', 'e2e'],
  },
};

export default nextConfig;
