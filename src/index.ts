import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

interface Env {
  CHAT_KV: KVNamespace;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  SILICONFLOW_API_KEY: string;
  WEB_SEARCH_URL?: string;
}

type Role = "system" | "user" | "assistant";
type ChatMessage = {
  role: Role;
  content: string;
  reasoning?: string;
  thinkingMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

type ChatRecord = {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  totalThinkingMs?: number;
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalTokens?: number;
};

const app = new Hono<{ Bindings: Env }>();
const SESSION_TTL = 60 * 60 * 24 * 7;
const CHAT_TTL = 60 * 60 * 24 * 30; // 30 天
const MAX_MESSAGE = 12000;
const MAX_MESSAGES = 80;
const CONTEXT_SOFT_LIMIT = 24000; // 约 token 软上限，超则压缩
const CONTEXT_HARD_LIMIT = 32000;
const MODELS = ["deepseek-ai/DeepSeek-V3.2", "deepseek-ai/DeepSeek-R1"] as const;
const MODEL_CONTEXT: Record<string, number> = {
  "deepseek-ai/DeepSeek-V3.2": 128000,
  "deepseek-ai/DeepSeek-R1": 163840,
};

function esc(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function estimateTokens(text: string): number {
  // 粗估：中文约 1.5 字/token，英文约 4 字符/token
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const rest = text.length - cn;
  return Math.ceil(cn / 1.5 + rest / 4);
}

function messagesTokenEstimate(msgs: ChatMessage[]): number {
  return msgs.reduce((n, m) => n + estimateTokens(m.content) + estimateTokens(m.reasoning || "") + 4, 0);
}

function page(title: string, body: string, scripts = "") {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark;--bg:#0b0d10;--panel:#11151a;--panel2:#171c22;--line:#27303a;--text:#eef2f7;--muted:#9aa6b2;--accent:#6ea8fe;--ok:#6ee7a8;--warn:#fbbf24}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}
.shell{height:100dvh;display:flex;position:relative}
.sidebar{width:280px;background:#0e1115;border-right:1px solid var(--line);padding:14px;display:flex;flex-direction:column;gap:12px;transition:width .2s,margin .2s,padding .2s,opacity .2s;overflow:hidden;flex-shrink:0}
.sidebar.collapsed{width:0;padding:0;margin:0;opacity:0;border:0;pointer-events:none}
.brand{font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:space-between;gap:8px;white-space:nowrap}
.new{width:100%;border:1px solid var(--line);background:var(--panel2);border-radius:9px;padding:10px;text-align:left;white-space:nowrap}
.history{overflow:auto;flex:1;min-height:0}.item{padding:9px 10px;border-radius:8px;display:flex;gap:8px;align-items:center;margin-bottom:3px;white-space:nowrap}
.item:hover,.item.active{background:var(--panel2)}
.item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.del{border:0;background:none;color:var(--muted);padding:2px 5px}
.footer{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;white-space:nowrap}
.main{min-width:0;flex:1;display:flex;flex-direction:column}
.top{min-height:56px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:8px 18px;flex-wrap:wrap}
.top select{background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:6px 8px}
.icon-btn{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:6px 10px;color:var(--muted)}
.icon-btn:hover{color:var(--text);border-color:#3a4654}
.stats{display:flex;flex-wrap:wrap;gap:8px 14px;font-size:12px;color:var(--muted);margin-left:auto}
.stats b{color:var(--text);font-weight:600}
.messages{flex:1;overflow:auto;padding:24px max(16px,calc((100% - 920px)/2))}
.msg{margin:0 auto 18px;max-width:920px}
.role{font-size:12px;color:var(--muted);margin-bottom:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.meta{font-size:11px;color:var(--muted);opacity:.9}
.bubble{white-space:pre-wrap;overflow-wrap:anywhere}
.bubble code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0a0d10;border:1px solid var(--line);border-radius:5px;padding:2px 4px}
.bubble pre{white-space:pre;overflow:auto;background:#080a0d;border:1px solid var(--line);padding:12px;border-radius:8px}.bubble p{margin:.6em 0}
.reasoning{margin:8px 0 10px;border:1px solid var(--line);border-radius:10px;background:#0c1015;overflow:hidden}
.reasoning summary{cursor:pointer;padding:8px 12px;color:var(--accent);font-size:12px;user-select:none;list-style:none}
.reasoning summary::-webkit-details-marker{display:none}
.reasoning summary::before{content:"▸ ";}
.reasoning[open] summary::before{content:"▾ ";}
.reasoning-body{padding:0 12px 12px;color:#b7c2ce;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;border-top:1px solid var(--line)}
.composer{padding:12px 16px;border-top:1px solid var(--line)}
.form{max-width:920px;margin:auto;display:flex;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px}
.form textarea{flex:1;resize:none;background:transparent;border:0;outline:0;min-height:44px;max-height:180px;padding:7px}
.send{align-self:flex-end;background:#eef2f7;color:#111;border:0;border-radius:8px;padding:9px 14px}
.send:disabled{opacity:.5;cursor:not-allowed}
.ctxbar{max-width:920px;margin:0 auto 8px;height:6px;background:#1a222b;border-radius:99px;overflow:hidden}
.ctxfill{height:100%;background:linear-gradient(90deg,var(--ok),var(--accent));transition:width .25s}
.ctxfill.warn{background:linear-gradient(90deg,var(--warn),#f87171)}
.login{min-height:100dvh;display:grid;place-items:center;padding:20px}
.card{width:min(380px,100%);background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:24px}
.card h1{margin-top:0}.field{display:block;margin:14px 0}
.field input{width:100%;padding:11px;border-radius:8px;border:1px solid var(--line);background:#0b0e12;outline:0}
.login button{width:100%;padding:11px;border:0;border-radius:8px;background:#eef2f7;color:#111}
.error{color:#ff9b9b;margin-bottom:10px}
.hint{font-size:12px;color:var(--muted);margin-top:6px}
@media(max-width:700px){.sidebar:not(.collapsed){width:220px;position:absolute;z-index:20;height:100%;box-shadow:8px 0 24px #0008}.messages{padding:18px 12px}.top{padding:8px 10px}.stats{width:100%;margin-left:0}}
@media(max-width:520px){.sidebar:not(.collapsed){width:min(86vw,280px)}.item{padding:8px 5px}.new{padding:8px}.footer span{display:none}}
</style></head><body>${body}${scripts}</body></html>`;
}

function loginPage(error = "") {
  return page("Login", `<div class="login"><form class="card" method="post" action="/login">
<h1>Private AI Chat</h1><p style="color:var(--muted)">Admin sign in</p>
${error ? `<div class="error">${esc(error)}</div>` : ""}
<label class="field">Username<input name="username" autocomplete="username" maxlength="128" required></label>
<label class="field">Password<input type="password" name="password" autocomplete="current-password" maxlength="256" required></label>
<button>Sign in</button></form></div>`);
}

function appPage() {
  const body = `<div class="shell">
<aside class="sidebar" id="sidebar">
  <div class="brand"><span>Private AI Chat</span></div>
  <button class="new" id="newChat">＋ New Chat</button>
  <button class="new" id="deleteAll">Delete all chats</button>
  <div class="history" id="history"></div>
  <div class="footer"><span>Admin</span><button class="del" id="logout">Logout</button></div>
</aside>
<main class="main">
  <header class="top">
    <button class="icon-btn" id="toggleSidebar" title="收起/展开侧边栏">☰</button>
    <strong id="title">New Chat</strong>
    <select id="model">
      <option value="deepseek-ai/DeepSeek-V3.2">DeepSeek-V3.2</option>
      <option value="deepseek-ai/DeepSeek-R1">DeepSeek-R1</option>
    </select>
    <div class="stats" id="stats">
      <span>本轮思考 <b id="stThink">—</b></span>
      <span>本轮 Token <b id="stTok">—</b></span>
      <span>会话累计 <b id="stTotal">—</b></span>
      <span>上下文 <b id="stCtx">0</b></span>
    </div>
  </header>
  <section class="messages" id="messages">
    <div class="msg"><div class="role">Assistant</div><div class="bubble">你好，我是你的私人 AI 助手。支持侧边栏收起、思考时间 / Token / 上下文占用展示、自动压缩上下文，以及 DeepSeek-R1 思维链查看。</div></div>
  </section>
  <div class="composer">
    <div class="ctxbar" title="上下文占用"><div class="ctxfill" id="ctxfill" style="width:0%"></div></div>
    <form class="form" id="form">
      <textarea id="input" maxlength="${MAX_MESSAGE}" placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"></textarea>
      <button class="send" id="sendBtn">发送</button>
    </form>
    <div class="hint" id="hint">历史保存在 Cloudflare KV（约 30 天）。上下文接近上限时会自动摘要压缩。</div>
  </div>
</main>
</div>`;

  const script = `<script>
const $=s=>document.querySelector(s);
const historyEl=$('#history'), messagesEl=$('#messages'), input=$('#input'), sendBtn=$('#sendBtn');
const MODEL_CTX={
  "deepseek-ai/DeepSeek-V3.2":128000,
  "deepseek-ai/DeepSeek-R1":163840
};
let currentId=null, currentModel='deepseek-ai/DeepSeek-V3.2', csrfToken="";
let sessionMeta={totalThinkingMs:0,totalPromptTokens:0,totalCompletionTokens:0,totalTokens:0,ctxTokens:0};

function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));}
function md(s){
  let x=esc(s);
  x=x.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g,'<pre><code>$1</code></pre>');
  x=x.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  x=x.replace(/^### (.*)$/gm,'<strong>$1</strong>').replace(/^## (.*)$/gm,'<strong>$1</strong>').replace(/^# (.*)$/gm,'<strong>$1</strong>');
  x=x.replace(/\\*\\*(.*?)\\*\\*/g,'<strong>$1</strong>');
  x=x.replace(/\\n\\n/g,'</p><p>').replace(/\\n/g,'<br>');
  return '<p>'+x+'</p>';
}
function fmtMs(ms){
  if(ms==null||ms<0)return '—';
  if(ms<1000)return ms+'ms';
  return (ms/1000).toFixed(1)+'s';
}
function fmtTok(n){
  if(n==null)return '—';
  if(n>=1000)return (n/1000).toFixed(1)+'k';
  return String(n);
}
function updateStats(partial){
  if(partial){
    if(partial.thinkingMs!=null)$('#stThink').textContent=fmtMs(partial.thinkingMs);
    if(partial.totalTokens!=null)$('#stTok').textContent=fmtTok(partial.totalTokens)+(partial.promptTokens!=null?' (in '+fmtTok(partial.promptTokens)+' / out '+fmtTok(partial.completionTokens)+')':'');
  }
  $('#stTotal').textContent=fmtTok(sessionMeta.totalTokens)+' · 思考 '+fmtMs(sessionMeta.totalThinkingMs);
  const limit=MODEL_CTX[currentModel]||128000;
  const pct=Math.min(100, Math.round((sessionMeta.ctxTokens/limit)*1000)/10);
  $('#stCtx').textContent=fmtTok(sessionMeta.ctxTokens)+' / '+fmtTok(limit)+' ('+pct+'%)';
  const fill=$('#ctxfill');
  fill.style.width=pct+'%';
  fill.classList.toggle('warn', pct>=75);
}
function renderMsg(role, content, meta={}){
  const d=document.createElement('div');d.className='msg';
  const bits=[];
  if(meta.thinkingMs!=null)bits.push('思考 '+fmtMs(meta.thinkingMs));
  if(meta.totalTokens!=null)bits.push('Token '+fmtTok(meta.totalTokens));
  else if(meta.promptTokens!=null||meta.completionTokens!=null)bits.push('Token in '+fmtTok(meta.promptTokens)+' / out '+fmtTok(meta.completionTokens));
  const metaHtml=bits.length?'<span class="meta">'+bits.join(' · ')+'</span>':'';
  let reasoningHtml='';
  if(meta.reasoning){
    reasoningHtml='<details class="reasoning"><summary>思维链（DeepSeek-R1）</summary><div class="reasoning-body">'+esc(meta.reasoning)+'</div></details>';
  }
  d.innerHTML='<div class="role">'+(role==='user'?'You':'Assistant')+metaHtml+'</div>'+reasoningHtml+'<div class="bubble"></div>';
  const bubble=d.querySelector('.bubble');
  if(role==='assistant')bubble.innerHTML=md(content||'');
  else bubble.innerHTML=esc(content||'').replace(/\\n/g,'<br>');
  messagesEl.appendChild(d);
  messagesEl.scrollTop=messagesEl.scrollHeight;
  return {root:d, bubble, reasoningEl:d.querySelector('.reasoning-body')};
}
async function initSecurity(){
  const r=await fetch('/api/security');
  if(r.ok){const j=await r.json();csrfToken=j.csrf;}
}
async function postJSON(url,body){
  return fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(body)});
}
async function deleteReq(url){
  return fetch(url,{method:'DELETE',headers:{'X-CSRF-Token':csrfToken}});
}
async function loadChats(){
  const r=await fetch('/api/chats');
  if(!r.ok)return;
  const xs=await r.json();
  historyEl.innerHTML='';
  xs.forEach(c=>{
    const d=document.createElement('div');
    d.className='item'+(c.id===currentId?' active':'');
    d.innerHTML='<span>'+esc(c.title||'New Chat')+'</span><button class="del" title="删除">×</button>';
    d.querySelector('span').onclick=()=>openChat(c.id);
    d.querySelector('.del').onclick=async e=>{
      e.stopPropagation();
      await deleteReq('/api/chats/'+encodeURIComponent(c.id));
      if(c.id===currentId)newChat();
      loadChats();
    };
    historyEl.appendChild(d);
  });
}
async function openChat(id){
  const r=await fetch('/api/chats/'+encodeURIComponent(id));
  if(!r.ok)return;
  const c=await r.json();
  currentId=c.id;
  currentModel=c.model||currentModel;
  $('#model').value=currentModel;
  $('#title').textContent=c.title||'New Chat';
  messagesEl.innerHTML='';
  sessionMeta={
    totalThinkingMs:c.totalThinkingMs||0,
    totalPromptTokens:c.totalPromptTokens||0,
    totalCompletionTokens:c.totalCompletionTokens||0,
    totalTokens:c.totalTokens||0,
    ctxTokens:0
  };
  (c.messages||[]).filter(x=>x.role!=='system').forEach(x=>{
    renderMsg(x.role,x.content,{
      reasoning:x.reasoning,
      thinkingMs:x.thinkingMs,
      promptTokens:x.promptTokens,
      completionTokens:x.completionTokens,
      totalTokens:x.totalTokens
    });
  });
  // 粗估上下文
  sessionMeta.ctxTokens=(c.messages||[]).reduce((n,m)=>n+Math.ceil(((m.content||'')+(m.reasoning||'')).length/2)+4,0);
  updateStats();
  loadChats();
}
function newChat(){
  currentId=null;
  $('#title').textContent='New Chat';
  messagesEl.innerHTML='<div class="msg"><div class="role">Assistant</div><div class="bubble">新对话已开始。</div></div>';
  sessionMeta={totalThinkingMs:0,totalPromptTokens:0,totalCompletionTokens:0,totalTokens:0,ctxTokens:0};
  updateStats();
  loadChats();
}
$('#toggleSidebar').onclick=()=>$('#sidebar').classList.toggle('collapsed');
$('#newChat').onclick=newChat;
$('#model').onchange=e=>{currentModel=e.target.value;updateStats();};
$('#deleteAll').onclick=async()=>{
  if(!confirm('确定删除全部聊天记录？'))return;
  await deleteReq('/api/chats');
  newChat();
};
$('#logout').onclick=async()=>{
  await fetch('/logout',{method:'POST',headers:{'X-CSRF-Token':csrfToken}});
  location='/login';
};
$('#form').onsubmit=async e=>{
  e.preventDefault();
  const text=input.value.trim();
  if(!text||sendBtn.disabled)return;
  input.value='';
  sendBtn.disabled=true;
  renderMsg('user',text);
  const ui=renderMsg('assistant','',{});
  const t0=performance.now();
  let reasoning='';
  let content='';
  try{
    const res=await postJSON('/api/chat',{chatId:currentId,model:currentModel,message:text});
    if(!res.ok){
      ui.bubble.textContent=await res.text();
      sendBtn.disabled=false;
      return;
    }
    const reader=res.body.getReader(),dec=new TextDecoder();
    let buf='';
    let lastMeta={};
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      buf+=dec.decode(value,{stream:true});
      const parts=buf.split('\\n\\n');
      buf=parts.pop()||'';
      for(const p of parts){
        if(!p.startsWith('data:'))continue;
        const data=p.slice(5).trim();
        if(data==='[DONE]')continue;
        try{
          const j=JSON.parse(data);
          if(j.error){ui.bubble.textContent=j.error;continue;}
          if(j.chatId)currentId=j.chatId;
          if(j.reasoning_delta){
            reasoning+=j.reasoning_delta;
            if(!ui.reasoningEl){
              const details=document.createElement('details');
              details.className='reasoning';
              details.open=true;
              details.innerHTML='<summary>思维链（DeepSeek-R1）思考中…</summary><div class="reasoning-body"></div>';
              ui.root.insertBefore(details, ui.bubble);
              ui.reasoningEl=details.querySelector('.reasoning-body');
            }
            ui.reasoningEl.textContent=reasoning;
            messagesEl.scrollTop=messagesEl.scrollHeight;
          }
          if(j.delta){
            content+=j.delta;
            ui.bubble.textContent=content;
            messagesEl.scrollTop=messagesEl.scrollHeight;
          }
          if(j.done){
            lastMeta=j;
            if(j.title)$('#title').textContent=j.title;
            if(j.totalThinkingMs!=null)sessionMeta.totalThinkingMs=j.totalThinkingMs;
            if(j.totalPromptTokens!=null)sessionMeta.totalPromptTokens=j.totalPromptTokens;
            if(j.totalCompletionTokens!=null)sessionMeta.totalCompletionTokens=j.totalCompletionTokens;
            if(j.totalTokens!=null)sessionMeta.totalTokens=j.totalTokens;
            if(j.ctxTokens!=null)sessionMeta.ctxTokens=j.ctxTokens;
            const think=j.thinkingMs!=null?j.thinkingMs:Math.round(performance.now()-t0);
            const roleEl=ui.root.querySelector('.role');
            const bits=['思考 '+fmtMs(think)];
            if(j.totalTokens!=null)bits.push('Token '+fmtTok(j.totalTokens)+' (in '+fmtTok(j.promptTokens)+' / out '+fmtTok(j.completionTokens)+')');
            let meta=roleEl.querySelector('.meta');
            if(!meta){meta=document.createElement('span');meta.className='meta';roleEl.appendChild(meta);}
            meta.textContent=bits.join(' · ');
            if(ui.reasoningEl){
              const sum=ui.root.querySelector('.reasoning summary');
              if(sum)sum.textContent='思维链（DeepSeek-R1）';
            }
            updateStats({thinkingMs:think,totalTokens:j.totalTokens,promptTokens:j.promptTokens,completionTokens:j.completionTokens});
          }
        }catch{}
      }
    }
    if(content)ui.bubble.innerHTML=md(content);
    else if(!ui.bubble.textContent)ui.bubble.textContent='（空回复）';
    loadChats();
  }catch(err){
    ui.bubble.textContent='请求失败：'+(err&&err.message?err.message:String(err));
  }finally{
    sendBtn.disabled=false;
    input.focus();
  }
};
input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#form').requestSubmit();}};
(async()=>{await initSecurity();loadChats();updateStats();})();
</script>`;
  return page("Private AI Chat", body, script);
}

async function sha256(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function sessionUser(c: any) {
  const token = getCookie(c, "session");
  if (!token) return false;
  return !!(await c.env.CHAT_KV.get(`session:${await sha256(token)}`));
}

async function rateLimited(env: Env, ip: string) {
  const key = `rl:login:${await sha256(ip)}`;
  const n = Number((await env.CHAT_KV.get(key)) || "0");
  if (n >= 8) return true;
  await env.CHAT_KV.put(key, String(n + 1), { expirationTtl: 900 });
  return false;
}

async function sf(
  env: Env,
  messages: any[],
  model: string,
  stream: boolean,
  extra: Record<string, unknown> = {}
) {
  const body: any = {
    model,
    messages,
    stream,
    temperature: model.includes("R1") ? 0.6 : 0.7,
    ...extra,
  };
  if (stream) {
    body.stream_options = { include_usage: true };
  }
  const r = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SILICONFLOW_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`SiliconFlow HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  return r;
}

async function generateTitle(env: Env, messages: ChatMessage[]) {
  try {
    const r = await sf(
      env,
      [
        { role: "system", content: "根据对话内容生成一个简短中文话题名。只输出标题，不要引号，不超过20个字。" },
        {
          role: "user",
          content: messages
            .filter(x => x.role !== "system")
            .slice(-6)
            .map(x => `${x.role}: ${x.content}`)
            .join("\n"),
        },
      ],
      "Qwen/Qwen3.5-9B",
      false
    );
    const j: any = await r.json();
    return String(j.choices?.[0]?.message?.content || "新对话").trim().slice(0, 30) || "新对话";
  } catch {
    return "新对话";
  }
}

async function compressMessages(env: Env, messages: ChatMessage[]): Promise<ChatMessage[]> {
  // 保留 system + 最近若干轮，中间摘要
  const system = messages.filter(m => m.role === "system");
  const rest = messages.filter(m => m.role !== "system");
  if (rest.length <= 12) return messages;

  const keepTail = rest.slice(-10);
  const toSummarize = rest.slice(0, -10);
  const text = toSummarize
    .map(m => `${m.role}: ${m.content}${m.reasoning ? "\n[reasoning]" + m.reasoning.slice(0, 400) : ""}`)
    .join("\n")
    .slice(0, 12000);

  try {
    const r = await sf(
      env,
      [
        {
          role: "system",
          content:
            "你是对话压缩助手。将以下多轮对话压缩成简洁中文摘要，保留关键事实、用户偏好、未完成任务与重要结论。不要发挥，只输出摘要正文。",
        },
        { role: "user", content: text },
      ],
      "Qwen/Qwen3.5-9B",
      false
    );
    const j: any = await r.json();
    const summary = String(j.choices?.[0]?.message?.content || "").trim().slice(0, 2000);
    if (!summary) return messages;
    return [
      ...system,
      { role: "system", content: "【历史对话摘要】\n" + summary },
      ...keepTail,
    ];
  } catch {
    // 失败则硬截断
    return [...system, ...rest.slice(-MAX_MESSAGES)];
  }
}

async function needSearch(question: string) {
  return /\b(最新|今天|近期|现在|新闻|价格|天气|比赛|发布|更新|2026|latest|today|news|price|weather)\b/i.test(
    question
  );
}

async function buildSearchQuery(env: Env, question: string) {
  try {
    const r = await sf(
      env,
      [
        { role: "system", content: "把用户问题改写成适合网页搜索的简短关键词。只输出搜索词，不要解释。" },
        { role: "user", content: question },
      ],
      "Qwen/Qwen3.5-35B-A3B",
      false
    );
    const j: any = await r.json();
    return String(j.choices?.[0]?.message?.content || question).trim().slice(0, 300);
  } catch {
    return question.slice(0, 300);
  }
}

async function webSearch(env: Env, query: string) {
  const endpoints = [env.WEB_SEARCH_URL || "https://html.duckduckgo.com/html/", "https://lite.duckduckgo.com/lite/"];

  for (const base of endpoints) {
    try {
      const u = new URL(base);
      u.searchParams.set("q", query);
      u.searchParams.set("kl", "cn-zh");
      const r = await fetch(u.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PrivateAIChat/1.0; +https://workers.cloudflare.com/)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      if (!r.ok) continue;
      const html = await r.text();
      const results = parseDuckDuckGoResults(html, u.origin);
      if (results.length) return results;
    } catch {
      // next
    }
  }
  return [];
}

function parseDuckDuckGoResults(html: string, origin: string) {
  const results: { name: string; url: string; snippet: string }[] = [];
  const seen = new Set<string>();

  const linkRe = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && results.length < 5) {
    const name = stripHtml(m[2]);
    const url = unwrapSearchUrl(m[1], origin);
    const block = html.slice(m.index, Math.min(html.length, m.index + 5000));
    const sm = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\//i);
    const snippet = sm ? stripHtml(sm[1]) : "";
    if (name && url && !seen.has(url)) {
      seen.add(url);
      results.push({ name, url, snippet });
    }
  }

  if (results.length) return results;

  const liteRe = /<a[^>]+class=["'][^"']*result-link[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = liteRe.exec(html)) && results.length < 5) {
    const name = stripHtml(m[2]);
    const url = unwrapSearchUrl(m[1], origin);
    const block = html.slice(m.index, Math.min(html.length, m.index + 5000));
    const sm = block.match(/class=["'][^"']*result-snippet[^"']*["'][^>]*>([\s\S]*?)<\//i);
    const snippet = sm ? stripHtml(sm[1]) : "";
    if (name && url && !seen.has(url)) {
      seen.add(url);
      results.push({ name, url, snippet });
    }
  }
  return results;
}

function unwrapSearchUrl(rawUrl: string, origin: string) {
  try {
    const parsed = new URL(rawUrl, origin);
    const redirected = parsed.searchParams.get("uddg");
    const url = redirected ? decodeURIComponent(redirected) : parsed.toString();
    return /^https?:\/\//i.test(url) &&
      !/^https?:\/\/(?:www\.)?(?:duckduckgo\.com|html\.duckduckgo\.com|lite\.duckduckgo\.com)\//i.test(url)
      ? url
      : "";
  } catch {
    return "";
  }
}

function stripHtml(s: string) {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchContext(env: Env, question: string) {
  if (!(await needSearch(question))) return "";
  const q = await buildSearchQuery(env, question);
  const results = await webSearch(env, q);
  if (!results.length) return "";
  return (
    "\n\n网页搜索结果（仅作为参考）：\n" +
    results.map((x: any, i: number) => `${i + 1}. ${x.name}\n${x.snippet}\n${x.url}`).join("\n")
  );
}

const chatKey = (id: string) => `chat:admin:${id}`;
const indexKey = () => `chats:admin`;

async function saveIndex(env: Env, id: string, title: string, updatedAt: number) {
  const raw = await env.CHAT_KV.get(indexKey());
  const xs: any[] = raw ? JSON.parse(raw) : [];
  const next = xs.filter(x => x.id !== id);
  next.unshift({ id, title, updatedAt });
  await env.CHAT_KV.put(indexKey(), JSON.stringify(next.slice(0, 100)), { expirationTtl: CHAT_TTL });
}

async function persistChat(env: Env, chat: ChatRecord) {
  chat.updatedAt = Date.now();
  await env.CHAT_KV.put(chatKey(chat.id), JSON.stringify(chat), { expirationTtl: CHAT_TTL });
  await saveIndex(env, chat.id, chat.title, chat.updatedAt);
}

app.get("/", c => c.redirect("/chat"));
app.get("/login", c => c.html(loginPage()));
app.post("/login", async c => {
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  if (await rateLimited(c.env, ip)) return c.html(loginPage("Too many login attempts. Try again later."), 429);
  const form = await c.req.parseBody();
  const u = String(form.username || "");
  const p = String(form.password || "");
  if (u !== c.env.ADMIN_USERNAME || p !== c.env.ADMIN_PASSWORD) return c.html(loginPage("Invalid credentials."), 401);
  const token = crypto.randomUUID() + crypto.randomUUID();
  const csrf = crypto.randomUUID() + crypto.randomUUID();
  await c.env.CHAT_KV.put(`session:${await sha256(token)}`, JSON.stringify({ user: "admin", csrf }), {
    expirationTtl: SESSION_TTL,
  });
  setCookie(c, "session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  return c.redirect("/chat");
});
app.post("/logout", async c => {
  if (!(await checkCsrf(c))) return c.redirect("/login");
  const token = getCookie(c, "session");
  if (token) await c.env.CHAT_KV.delete(`session:${await sha256(token)}`);
  deleteCookie(c, "session", { path: "/" });
  return c.redirect("/login");
});

app.get("/chat", async c => {
  if (!(await sessionUser(c))) return c.redirect("/login");
  return c.html(appPage());
});

async function checkCsrf(c: any) {
  const token = getCookie(c, "session");
  const supplied = c.req.header("X-CSRF-Token");
  if (!token || !supplied) return false;
  const raw = await c.env.CHAT_KV.get(`session:${await sha256(token)}`);
  if (!raw) return false;
  try {
    return JSON.parse(raw).csrf === supplied;
  } catch {
    return false;
  }
}

app.get("/api/security", async c => {
  const token = getCookie(c, "session");
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const raw = await c.env.CHAT_KV.get(`session:${await sha256(token)}`);
  if (!raw) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json({ csrf: JSON.parse(raw).csrf });
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
});

app.get("/api/chats", async c => {
  if (!(await sessionUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const raw = await c.env.CHAT_KV.get(indexKey());
  let xs: any[] = raw ? JSON.parse(raw) : [];
  const alive: any[] = [];
  for (const x of xs) {
    if (await c.env.CHAT_KV.get(chatKey(x.id))) alive.push(x);
  }
  if (alive.length !== xs.length) {
    await c.env.CHAT_KV.put(indexKey(), JSON.stringify(alive), { expirationTtl: CHAT_TTL });
  }
  return c.json(alive);
});

app.get("/api/chats/:id", async c => {
  if (!(await sessionUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  if (!/^[a-f0-9-]{10,80}$/.test(id)) return c.json({ error: "Invalid id" }, 400);
  const x = (await c.env.CHAT_KV.get(chatKey(id), "json")) as ChatRecord | null;
  return x ? c.json(x) : c.json({ error: "Not found" }, 404);
});

app.delete("/api/chats/:id", async c => {
  if (!(await sessionUser(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!(await checkCsrf(c))) return c.json({ error: "CSRF validation failed" }, 403);
  const id = c.req.param("id");
  await c.env.CHAT_KV.delete(chatKey(id));
  const raw = await c.env.CHAT_KV.get(indexKey());
  const xs: any[] = raw ? JSON.parse(raw) : [];
  await c.env.CHAT_KV.put(indexKey(), JSON.stringify(xs.filter(x => x.id !== id)), { expirationTtl: CHAT_TTL });
  return c.json({ ok: true });
});

app.delete("/api/chats", async c => {
  if (!(await sessionUser(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!(await checkCsrf(c))) return c.json({ error: "CSRF validation failed" }, 403);
  const raw = await c.env.CHAT_KV.get(indexKey());
  const xs: any[] = raw ? JSON.parse(raw) : [];
  await Promise.all(xs.map(x => c.env.CHAT_KV.delete(chatKey(x.id))));
  await c.env.CHAT_KV.delete(indexKey());
  return c.json({ ok: true });
});

app.post("/api/chat", async c => {
  if (!(await sessionUser(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!(await checkCsrf(c))) return c.json({ error: "CSRF validation failed" }, 403);

  const b = await c.req.json<{ chatId?: string; model?: string; message?: string }>();
  const message = String(b.message || "").trim();
  if (!message || message.length > MAX_MESSAGE) return c.text("Invalid message", 400);
  const model = MODELS.includes(b.model as any) ? (b.model as string) : MODELS[0];
  const id = b.chatId && /^[a-f0-9-]{10,80}$/.test(b.chatId) ? b.chatId : crypto.randomUUID();

  let chat = (await c.env.CHAT_KV.get(chatKey(id), "json")) as ChatRecord | null;
  if (!chat) {
    chat = {
      id,
      title: "New Chat",
      model,
      messages: [{ role: "system", content: "You are a helpful assistant." }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      totalThinkingMs: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
    };
  }
  chat.model = model;
  chat.messages.push({ role: "user", content: message });

  // 自动上下文压缩
  let est = messagesTokenEstimate(chat.messages);
  if (est > CONTEXT_SOFT_LIMIT || chat.messages.length > MAX_MESSAGES) {
    chat.messages = await compressMessages(c.env, chat.messages);
    est = messagesTokenEstimate(chat.messages);
  }
  if (est > CONTEXT_HARD_LIMIT) {
    const system = chat.messages.filter(m => m.role === "system").slice(0, 2);
    const rest = chat.messages.filter(m => m.role !== "system").slice(-20);
    chat.messages = [...system, ...rest];
  }

  // 先落盘用户消息，避免流中断导致丢失
  try {
    await persistChat(c.env, chat);
  } catch (e) {
    console.error("persist user message failed", e);
  }

  const context = await searchContext(c.env, message);
  const upstreamMessages: any[] = chat.messages.map(m => {
    const o: any = { role: m.role, content: m.content };
    // R1 多轮时如有 reasoning 可回传（部分模型需要）
    if (m.reasoning && model.includes("R1")) o.reasoning_content = m.reasoning;
    return o;
  });
  if (context) {
    upstreamMessages.push({
      role: "system",
      content:
        "Use the following web search results when useful. Do not claim you browsed if no results are present." +
        context,
    });
  }

  const started = Date.now();
  let r: Response;
  try {
    const extra: Record<string, unknown> = {};
    if (model.includes("R1")) {
      extra.thinking_budget = 8192;
    }
    r = await sf(c.env, upstreamMessages, model, true, extra);
  } catch (e: any) {
    return c.text(e?.message || "Upstream error", 502);
  }

  const reader = r.body?.getReader();
  if (!reader) return c.text("No response body", 502);

  const encoder = new TextEncoder();
  let assistant = "";
  let reasoning = "";
  let buf = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += new TextDecoder().decode(value, { stream: true });
          const parts = buf.split("\n");
          buf = parts.pop() || "";
          for (const line of parts) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const data = s.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const j: any = JSON.parse(data);
              if (j.usage) usage = j.usage;
              const delta = j.choices?.[0]?.delta || {};
              if (delta.reasoning_content) {
                reasoning += delta.reasoning_content;
                send({ reasoning_delta: delta.reasoning_content, chatId: id });
              }
              if (delta.content) {
                assistant += delta.content;
                send({ delta: delta.content, chatId: id });
              }
            } catch {
              // ignore partial json
            }
          }
        }

        const thinkingMs = Date.now() - started;
        const promptTokens = usage?.prompt_tokens ?? estimateTokens(JSON.stringify(upstreamMessages));
        const completionTokens =
          usage?.completion_tokens ?? estimateTokens(assistant) + estimateTokens(reasoning);
        const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;

        const asstMsg: ChatMessage = {
          role: "assistant",
          content: assistant,
          thinkingMs,
          promptTokens,
          completionTokens,
          totalTokens,
        };
        if (reasoning) asstMsg.reasoning = reasoning;

        chat!.messages.push(asstMsg);
        chat!.totalThinkingMs = (chat!.totalThinkingMs || 0) + thinkingMs;
        chat!.totalPromptTokens = (chat!.totalPromptTokens || 0) + promptTokens;
        chat!.totalCompletionTokens = (chat!.totalCompletionTokens || 0) + completionTokens;
        chat!.totalTokens = (chat!.totalTokens || 0) + totalTokens;

        if (chat!.title === "New Chat") {
          try {
            chat!.title = await generateTitle(c.env, chat!.messages);
          } catch {
            chat!.title = "新对话";
          }
        }

        // 最终持久化（含 assistant）
        await persistChat(c.env, chat!);

        const ctxTokens = messagesTokenEstimate(chat!.messages);
        send({
          done: true,
          chatId: id,
          title: chat!.title,
          thinkingMs,
          promptTokens,
          completionTokens,
          totalTokens,
          totalThinkingMs: chat!.totalThinkingMs,
          totalPromptTokens: chat!.totalPromptTokens,
          totalCompletionTokens: chat!.totalCompletionTokens,
          totalTokensSession: chat!.totalTokens,
          totalTokens: totalTokens,
          ctxTokens,
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (e) {
        console.error(e);
        // 尽量保存已有部分回复
        try {
          if (assistant || reasoning) {
            const thinkingMs = Date.now() - started;
            chat!.messages.push({
              role: "assistant",
              content: assistant || "(interrupted)",
              reasoning: reasoning || undefined,
              thinkingMs,
            });
            await persistChat(c.env, chat!);
          }
        } catch {}
        send({ error: "Upstream error" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.notFound(c => c.text("Not Found", 404));
app.onError((e, c) => {
  console.error(e);
  return c.text("Internal Server Error", 500);
});
export default app;
