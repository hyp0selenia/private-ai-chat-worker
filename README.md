# Private AI Chat

一个部署在 Cloudflare Workers 上的极简单账号私人 AI Chat。

- 单一 admin 账号
- SiliconFlow API Key 只在 Worker Secret 中
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

创建 KV：

```bash
npx wrangler kv namespace create CHAT_KV
```

把输出的 namespace id 填入 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  { "binding": "CHAT_KV", "id": "YOUR_KV_ID" }
]
```

然后设置 Secrets：

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SILICONFLOW_API_KEY
```

网页搜索默认无需 Secret。程序会优先使用 DuckDuckGo HTML，失败后自动尝试 DuckDuckGo Lite；如需更换入口，可设置 `WEB_SEARCH_URL`。

## 3. 环境变量

必须：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SILICONFLOW_API_KEY`

可选：

- `WEB_SEARCH_URL`（可选，默认 `https://html.duckduckgo.com/html/`）

真实 Secret 不要提交 GitHub。

## 4. 本地运行

```bash
npm install
cp .env.example .dev.vars
npm run dev
```

## 5. 部署

```bash
npm run deploy
```

## 6. GitHub 自动部署

在 Cloudflare Dashboard：

Workers & Pages → Create application → Import a repository

选择 GitHub 仓库并部署。Cloudflare Workers Builds 会在仓库 push 后自动构建和部署。

Secrets 保存在 Cloudflare Worker 中，不放进 GitHub。

## 7. 模型

聊天：

- `deepseek-ai/DeepSeek-V3.2`
- `deepseek-ai/DeepSeek-R1`

话题命名：

- `Qwen/Qwen3.5-9B`

搜索词构建：

- `Qwen3.5-35B-A3B`

具体模型可用性以 SiliconFlow 当前模型列表为准。
