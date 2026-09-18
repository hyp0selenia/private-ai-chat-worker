# Private AI Chat

一个部署在 Cloudflare Workers 上的极简单账号私人 AI Chat。

- 单一 admin 账号
- 账号密码与 API Key 全部通过 Worker Secrets（环境变量）设置，不会写进代码或仓库
- Secrets 只需设置一次，后续每次构建/部署自动保留，无需重复输入
- 多轮对话、Markdown、代码高亮、Streaming
- **侧边栏可收起/展开**
- **每句思考时间 + 会话累计思考时间**
- **每句 Token 消耗（prompt / completion / total）+ 会话累计**
- **上下文占用进度条与估算**
- **上下文自动压缩**（超过软上限时用小模型摘要历史）
- **DeepSeek-R1 思维链（reasoning_content）可展开查看**
- 聊天历史、删除单条、删除全部
- **KV 保存聊天记录**（默认约 30 天过期；用户消息先落盘，流结束后再保存完整回复，降低丢失风险）
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

> 聊天记录保存在 KV。若你希望更长保留或大体积历史，可自行扩展为 R2（当前版本已强化 KV 写入时机与 TTL）。

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
cat > .dev.vars << 'EOFDEV'
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的本地密码
SILICONFLOW_API_KEY=sk-xxxxxxxx
EOFDEV
npm run dev
```

`.dev.vars` 已在 `.gitignore` 中，不会被提交。

## 5. 部署

```bash
npm run deploy
```

部署前请确保已通过 `wrangler secret put` 或 Dashboard 设置好三个 Secret，且 `wrangler.jsonc` 中的 KV id 正确。

## 6. GitHub 自动部署

在 Cloudflare Dashboard：

Workers & Pages → Create application → Import a repository

选择 GitHub 仓库并部署。Cloudflare Workers Builds 会在仓库 push 后自动构建和部署。

**重要**：在 Dashboard 的该 Worker → Settings → Variables and Secrets 中设置一次 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`SILICONFLOW_API_KEY` 即可。之后每次自动构建都会自动使用这些 Secret，无需重复输入。

## 7. 模型

聊天：

- `deepseek-ai/DeepSeek-V3.2`
- `deepseek-ai/DeepSeek-R1`（支持思维链 reasoning_content）

话题命名 / 上下文压缩：

- `Qwen/Qwen3.5-9B`

搜索词构建：

- `Qwen/Qwen3.5-35B-A3B`

具体模型可用性以 SiliconFlow 当前模型列表为准。

## 8. 新功能说明

| 功能 | 说明 |
|------|------|
| 侧边栏收起 | 顶栏 ☰ 按钮切换；移动端展开为浮层 |
| 思考时间 | 每条 assistant 消息显示本轮耗时；顶栏显示本轮与会话累计 |
| Token | 优先使用上游 `usage`；无则粗估。显示 in/out/total |
| 上下文占用 | 顶栏数字 + 输入区上方进度条（≥75% 变黄） |
| 自动压缩 | 消息数或估算 token 超软上限时，用小模型摘要旧轮次并保留最近对话 |
| R1 思维链 | 流式展示 reasoning；可折叠查看完整思维链 |
| 历史保存 | 用户消息先写入 KV，流结束后再写入完整 assistant（含 reasoning/token/时间），减少中断丢记录 |

若部署后仍看不到历史，请检查：

1. Dashboard 中该 Worker 是否已绑定正确的 `CHAT_KV`
2. Secrets 是否齐全
3. 浏览器是否登录成功（`/api/chats` 返回 401 表示会话无效）
