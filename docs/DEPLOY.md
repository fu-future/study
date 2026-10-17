# 部署说明

> ## ⚠️ 验证状态声明（请先读）
>
> | 项目 | 状态 |
> |---|---|
> | 本机 `npm run dev` 本地运行 | ✅ **已实测**（见 docs/ACCEPTANCE.md） |
> | 本机 `npm run build` 生产构建 | ✅ **已实测**（见 docs/ACCEPTANCE.md） |
> | `Dockerfile` / `docker-compose.yml` | ⚠️ **未执行验证** —— 开发机未安装 Docker |
> | PostgreSQL 数据源 | ⚠️ **未执行验证** —— 只离线推导了参考 SQL |
>
> 因此：**本文档第 1、2 节的本地运行方式是已验证的；第 3 节的 Docker 流程是"已编写但待验证"的。**
> 在你自己跑通之前，请不要把它当作已验证的部署方案。

---

## 1. 本地运行（推荐，已实测）

**只需要 Node.js ≥ 20.9 和 npm**，不需要 Docker，也不需要任何数据库服务。

```bash
npm install
cp .env.example .env          # 然后设置 SESSION_SECRET
npm run setup                 # 生成客户端 + 应用迁移 + 写入演示数据
npm run dev                   # http://localhost:3000
```

生产模式本地跑：

```bash
npm run build
npm run start                 # 默认 3000 端口
```

---

## 2. 直接部署（不用 Docker）

适用于已有 Node 环境的服务器：

```bash
# 1) 拉代码并安装生产依赖
npm ci

# 2) 配置环境变量（至少 SESSION_SECRET；生产必须换成随机值）
cp .env.example .env && vi .env

# 3) 构建
npm run build

# 4) 应用数据库迁移（幂等，可重复执行）
npx prisma migrate deploy

# 5) 启动（建议用 systemd / pm2 托管）
NODE_ENV=production npm run start
```

### 用 systemd 托管（示例）

```ini
[Unit]
Description=AI Study Coach
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/ai-study-coach
EnvironmentFile=/srv/ai-study-coach/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start
Restart=on-failure
User=studycoach
# 只允许写入数据目录
ReadWritePaths=/srv/ai-study-coach/.data
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

---

## 3. Docker 部署（已编写，**待验证**）

```bash
cp .env.example .env          # 设置 SESSION_SECRET
docker compose up -d --build
docker compose ps             # 等待 healthy
docker compose logs -f app
```

访问 `http://localhost:3000`。

### 这个配置里已经考虑到的事情

| 关注点 | 做法 |
|---|---|
| **SQLite 数据持久化** | 命名卷 `study-coach-data` 挂载到 `/app/.data`（数据库 + 上传文件都在这里） |
| **上传文件持久化** | 上传目录 `UPLOAD_DIR=/app/.data/uploads`，与数据库同卷，保证备份一致 |
| **环境变量** | 通过 `env_file: .env` 注入；**密钥不写进 compose 文件** |
| **健康检查** | 打 `/api/health`，它同时验证服务存活与数据库连通 |
| **权限** | 容器以非 root 的 `node` 用户运行；`/app/.data` 已 chown 给该用户 |
| **迁移** | 容器启动时执行 `prisma migrate deploy`（幂等） |
| **单副本约束** | `replicas: 1` —— SQLite 是单写者模型，多副本共享同一文件会出问题 |

### 首次使用请逐项核对

```text
[ ] 1. docker compose build 能成功（尤其确认 Prisma 引擎在 slim 镜像里能跑）
[ ] 2. 容器启动后 docker compose ps 显示 healthy
[ ] 3. curl http://localhost:3000/api/health 返回 status: "ok" 且 database.ok = true
[ ] 4. 能注册账号并登录（验证 SESSION_SECRET 生效）
[ ] 5. 上传一张题目图片成功，且重启容器后图片仍能打开（验证卷持久化）
[ ] 6. 重启容器后，之前录入的错题与掌握度数据仍在（验证数据库持久化）
[ ] 7. docker compose down && docker compose up -d 后数据不丢
[ ] 8. 用非 root 用户确认容器内进程身份（docker compose exec app whoami → node）
[ ] 9. 确认镜像里不含 .env 与 .data（docker compose exec app ls -la /app）
[ ] 10. 备份卷并恢复一次，确认备份流程可用
```

### 备份与恢复（Docker）

```bash
# 备份：把卷内容导出成 tar
docker run --rm \
  -v ai-study-coach_study-coach-data:/data \
  -v "$PWD/.data/backup:/backup" \
  alpine tar czf /backup/study-coach-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .

# 恢复
docker compose down
docker run --rm \
  -v ai-study-coach_study-coach-data:/data \
  -v "$PWD/.data/backup:/backup" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/<备份文件>.tar.gz -C /data"
docker compose up -d
```

> 卷名前缀取决于 compose 的项目名（默认是目录名）。

---

## 4. 反向代理与 HTTPS

应用通过 `sc_session` Cookie 维护会话，生产环境（`NODE_ENV=production`）会自动加上
`Secure` 属性 —— 这意味着**必须通过 HTTPS 访问**，否则浏览器不会发送该 Cookie、无法登录。

Nginx 示例：

```nginx
server {
  listen 443 ssl http2;
  server_name study.example.com;

  ssl_certificate     /etc/letsencrypt/live/study.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/study.example.com/privkey.pem;

  # AI 答疑是 SSE 流式响应，必须关闭缓冲，否则内容会被攒着一次性返回
  location /api/chat {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    chunked_transfer_encoding off;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # 上传体积要匹配 UPLOAD_MAX_BYTES
  client_max_body_size 6m;
}
```

> **SSE 缓冲没关会导致"AI 回答卡住很久才一次性出现"** —— 这是最常见的部署坑。

---

## 5. 升级流程

```bash
git pull
npm ci
npm run build

# 先备份！迁移可能有破坏性变更
cp .data/dev.db ".data/backup/dev-$(date +%Y%m%d-%H%M%S).db"

npx prisma migrate deploy     # 应用新迁移（幂等）
npm run start                 # 或 pm2/systemd/docker compose 重启
```

---

## 6. 部署前安全清单

```text
[ ] SESSION_SECRET 已替换为随机值（≥32 字符），且未提交到版本库
[ ] .env 未被 git 跟踪（.gitignore 已忽略；可用 git check-ignore .env 验证）
[ ] 如果对外开放：ALLOW_SELF_SIGNUP=false（关闭自助注册）
[ ] 演示账号 demo@study.local 已删除或改密码（它的密码是公开的固定值）
[ ] AI_API_KEY 只存在于服务器环境变量中
[ ] DATABASE_URL 的权限已收紧（SQLite 文件仅服务运行用户可读写）
[ ] UPLOAD_DIR 不在 Web 根目录下（本项目默认在 .data/，已满足）
[ ] 反向代理已启用 HTTPS（否则 Secure Cookie 不生效，无法登录）
[ ] 已配置数据备份（SQLite 文件 + 上传目录）
[ ] 已确认 .data 目录不会被误删（里面是全部学习记录）
[ ] 有未成年人数据保护意识：默认不公开、支持导出、支持归档删除
```

---

## 7. 关于公网部署

本项目**尚未**做过面向公网的安全加固与压力验证。若要上线：

1. 先按第 6 节逐项检查
2. 完成 [docs/AI_PROVIDER.md](AI_PROVIDER.md) 第 5 节的真实 API 验收
3. 限流目前是**进程内**实现（`src/lib/ai/rate-limit.ts`），
   多实例部署需要替换为 Redis 等共享存储，否则每个实例各限各的
4. 评估是否需要迁移到 PostgreSQL（SQLite 适合单实例、中小规模）
