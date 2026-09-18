# Architecture

Browser
→ HttpOnly session cookie
→ Cloudflare Worker / Hono
→ KV

AI:

Browser → Worker → SiliconFlow

Search:

question
→ search heuristic
→ Qwen search-query model
→ Bing
→ compact context
→ chat model

KV:

- `session:<sha256(token)>` → admin session, 7d TTL
- `chat:admin:<uuid>` → complete chat JSON, 7d TTL
- `chats:admin` → chat index JSON, 7d TTL

Only one admin exists, so no user table or relational database is used.
