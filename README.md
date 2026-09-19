# Private AI Chat

部署在 Cloudflare Workers 上的私人 AI 聊天。

浏览器只与 Worker 通信，API Key 不暴露给前端。

## 功能

- admin / user 双账号登录（共用同一份聊天记录）
- admin 可删除单条 / 全部聊天；user 无删除权限
- 多轮对话、Markdown、代码高亮、流式输出
- 侧边栏收起 / 展开
- 每句思考时间与会话累计
- Token 消耗统计（单句 + 会话）
- 上下文占用进度条与自动压缩
- 推理模型思维链可展开查看
- 聊天历史保存（R2）

## 配置

### 1. 创建 KV（会话与登录限流）

```bash
npx wrangler kv namespace create CHAT_KV
```

将 namespace id 填入 `wrangler.jsonc` 的 `kv_namespaces`。

### 2. 创建 R2（聊天记录）

```bash
npx wrangler r2 bucket create private-ai-chat
```

在 `wrangler.jsonc` 中配置：

```jsonc
"r2_buckets": [
  { "binding": "CHAT_R2", "bucket_name": "private-ai-chat" }
]
```

### 3. 设置 Secrets（只需一次）

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put USER_USERNAME
npx wrangler secret put USER_PASSWORD
npx wrangler secret put SILICONFLOW_API_KEY
```

或在 Cloudflare Dashboard → Workers → Settings → Variables and Secrets 中添加。

| 变量 | 说明 |
|------|------|
| `ADMIN_USERNAME` | admin 登录用户名 |
| `ADMIN_PASSWORD` | admin 登录密码 |
| `USER_USERNAME` | user 登录用户名 |
| `USER_PASSWORD` | user 登录密码 |
| `SILICONFLOW_API_KEY` | SiliconFlow API Key |

Secrets 保存在 Cloudflare 侧，不会进入仓库，后续部署自动保留。

## 本地运行

```bash
npm install
cat > .dev.vars << 'EOF'
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的本地密码
USER_USERNAME=user
USER_PASSWORD=你的本地密码
SILICONFLOW_API_KEY=sk-xxxxxxxx
EOF
npm run dev
```

`.dev.vars` 已在 `.gitignore` 中。

## 部署

```bash
npm run deploy
```

也可通过 Cloudflare GitHub 集成：Import repository 后自动构建部署。Secrets 在 Dashboard 设置一次即可。

## 模型

| 用途 | 模型 |
|------|------|
| 聊天（快速） | `deepseek-ai/DeepSeek-V3.2` |
| 聊天（推理） | `deepseek-ai/DeepSeek-R1` |
| 标题概括 | `Qwen/Qwen3.5-9B` |
| 上下文压缩 | `Qwen/Qwen3.5-35B-A3B` |

## AI

100% AI Generated
