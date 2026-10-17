# =============================================================================
# AI 高中学习教练 — 生产镜像
#
# ⚠️ 状态：**未在真实 Docker 环境中构建或运行验证过**（开发机未安装 Docker）。
#    配置按 Next.js + Prisma + SQLite 的常规实践编写并逐行注释，
#    但不能声称"已验证可部署"。首次使用请按 docs/DEPLOY.md 的清单逐项核对。
#
# 关键设计：
#   - 多阶段构建：builder 里装依赖 + 构建，runner 只带运行时需要的东西
#   - SQLite 数据库与上传文件都在 /app/.data，通过**数据卷**持久化
#   - 非 root 用户运行（node 用户，uid 1000）
#   - HEALTHCHECK 直接打 /api/health（它同时验证了数据库连通性）
# =============================================================================

# -----------------------------------------------------------------------------
# 阶段 1：依赖
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

# Prisma 的可执行文件依赖 openssl；ca-certificates 用于 HTTPS 请求
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 只复制依赖清单，最大化利用 Docker 层缓存
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma

# npm ci 需要 lockfile；若仓库里没有 lockfile，请在本地先执行 npm install
RUN npm ci --ignore-scripts \
  # Prisma 的 postinstall 被 --ignore-scripts 跳过了，这里显式生成客户端
  && npx prisma generate

# -----------------------------------------------------------------------------
# 阶段 2：构建
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 构建期需要 DATABASE_URL 满足 env 校验，但**不连接数据库**。
# 这里给一个占位值，运行时会被 compose 提供的真实值覆盖。
ENV DATABASE_URL="file:../.data/dev.db"
ENV NEXT_TELEMETRY_DISABLED=1
# 一个仅用于通过构建期校验的占位密钥；运行时会用真实密钥覆盖
ENV SESSION_SECRET="build-time-placeholder-secret-not-used-at-runtime-32"
ENV AI_PROVIDER="mock"

RUN npm run build

# -----------------------------------------------------------------------------
# 阶段 3：运行
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# 数据库与上传文件都放在这个目录，由数据卷挂载持久化
ENV UPLOAD_DIR=/app/.data/uploads

# 运行时需要的文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/prisma ./prisma

# 数据目录：先建好并交给 node 用户，避免容器内以 root 写入宿主目录
RUN mkdir -p /app/.data/uploads \
  && chown -R node:node /app/.data

USER node

EXPOSE 3000

# 探测 /api/health：它同时验证了「服务是否起来」与「数据库是否连通」
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health > /dev/null || exit 1

# 启动前先应用迁移（幂等），然后启动服务。
# 用 `sh -c` 是因为 CMD 的 exec 形式不支持 && 链。
# 注意：多副本部署时迁移应在单独的 job 里执行一次，而不是每个副本都跑。
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
