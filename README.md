# Private AI Chat

一个部署在 Cloudflare Workers 上的极简单账号私人 AI Chat。

- 单一 admin 账号
- 账号密码与 API Key 全部通过 Worker Secrets（环境变量）设置，不会写进代码或仓库
- Secrets 只需设置一次，后续每次构建/部署自动保留，无需重复输入
- 多轮对话、Markdown、代码高亮、Streaming
- 聊天历史、删除单条、删除全部
- KV 保存聊天记录，7 天自动过期
- 自动网页搜索（DuckDuckGo HTML / Lite 免费搜索，无需 API Key）
- Cloudflare GitHub 集成可自动部署

## 1. 项目是什么

浏览器只与 Cloudflare Worker 通信：

Browser → Worker → SiliconFlow

前端不会拿到 SiliconFlow API Key。

## 2. Cloudflare 配置

### 2.1 创建 KV

```bash
npx wrangler kv namespace create CHAT_KV
```

把输出的 namespace id 填入 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  { "binding": "CHAT_KV", "id": "YOUR_KV_ID" }
]
```

### 2.2 设置 Secrets（只需一次，之后构建会自动保留）

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SILICONFLOW_API_KEY
```

也可以在 Cloudflare Dashboard 操作：

Workers & Pages → 你的 Worker → Settings → Variables and Secrets → Add

- `ADMIN_USERNAME`：登录用户名
- `ADMIN_PASSWORD`：登录密码
- `SILICONFLOW_API_KEY`：SiliconFlow API Key

Secrets 保存在 Cloudflare 侧，**不会进入 Git 仓库**，后续每次部署/构建都会自动带上，无需重新输入。

网页搜索默认无需 Secret。程序会优先使用 DuckDuckGo HTML，失败后自动尝试 DuckDuckGo Lite；如需更换入口，可额外设置 `WEB_SEARCH_URL`。

## 3. 环境变量说明

| 变量 | 类型 | 说明 |
|------|------|------|
| `ADMIN_USERNAME` | Secret | 登录用户名，必须 |
| `ADMIN_PASSWORD` | Secret | 登录密码，必须 |
| `SILICONFLOW_API_KEY` | Secret | SiliconFlow API Key，必须 |
| `WEB_SEARCH_URL` | 可选 | 默认 `https://html.duckduckgo.com/html/` |

## 4. 本地运行

```bash
npm install
# 创建本地密钥文件（不会提交到 Git）
cat > .dev.vars << 'EOF'
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的本地密码
SILICONFLOW_API_KEY=sk-xxxxxxxx
EOF
npm run dev
```

`.dev.vars` 已在 `.gitignore` 中，不会被提交。

## 5. 部署

```bash
npm run deploy
```

部署前请确保已通过 `wrangler secret put` 或 Dashboard 设置好三个 Secret。

## 6. GitHub 自动部署

在 Cloudflare Dashboard：

Workers & Pages → Create application → Import a repository

选择 GitHub 仓库并部署。Cloudflare Workers Builds 会在仓库 push 后自动构建和部署。

**重要**：在 Dashboard 的该 Worker → Settings → Variables and Secrets 中设置一次 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`SILICONFLOW_API_KEY` 即可。之后每次自动构建都会自动使用这些 Secret，无需重复输入。

## 7. 模型

聊天：

- `deepseek-ai/DeepSeek-V3.2`
- `deepseek-ai/DeepSeek-R1`

话题命名：

- `Qwen/Qwen3.5-9B`

搜索词构建：

- `Qwen3.5-35B-A3B`

具体模型可用性以 SiliconFlow 当前模型列表为准。
