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
const CHAT_TTL = 60 * 60 * 24 * 30;
const MAX_MESSAGE = 12000;
const MAX_MESSAGES = 80;
const CONTEXT_SOFT_LIMIT = 24000;
const CONTEXT_HARD_LIMIT = 32000;
const MODELS = ["deepseek-ai/DeepSeek-V3.2", "deepseek-ai/DeepSeek-R1"] as const;
const MODEL_CONTEXT: Record<string, number> = {
  "deepseek-ai/DeepSeek-V3.2": 128000,
  "deepseek-ai/DeepSeek-R1": 163840,
};
const MODEL_TITLE = "Qwen/Qwen3.5-9B";
const MODEL_HELPER = "Qwen/Qwen3.5-35B-A3B";
const SYSTEM_PROMPT =
  "你是一个有帮助、诚实、简洁的私人 AI 助手。用用户使用的语言回答。回答准确、有条理；不确定时明确说明。需要时给出步骤或示例，避免废话。";

function esc(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function estimateTokens(text: string): number {
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const rest = text.length - cn;
  return Math.ceil(cn / 1.5 + rest / 4);
}

function messagesTokenEstimate(msgs: ChatMessage[]): number {
  return msgs.reduce((n, m) => n + estimateTokens(m.content || "") + estimateTokens(m.reasoning || "") + 4, 0);
}

function page(title: string, body: string, scripts = "") {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark;--bg:#0b0d10;--panel:#11151a;--panel2:#171c22;--line:#27303a;--text:#eef2f7;--muted:#9aa6b2;--accent:#6ea8fe;--ok:#6ee7a8;--warn:#fbbf24;--danger:#f87171}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}
.shell{height:100dvh;display:flex;position:relative}
.sidebar{width:280px;background:#0e1115;border-right:1px solid var(--line);padding:14px;display:flex;flex-direction:column;gap:12px;transition:transform .22s ease,width .22s ease;flex-shrink:0;z-index:30}
.sidebar.collapsed{width:0;padding:0;border:0;overflow:hidden}
.brand{font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:space-between;gap:8px;white-space:nowrap}
.brand .close-sb{display:none;border:0;background:none;color:var(--muted);font-size:18px;padding:4px 8px}
.new{width:100%;border:1px solid var(--line);background:var(--panel2);border-radius:9px;padding:10px;text-align:left;white-space:nowrap}
.history{overflow:auto;flex:1;min-height:0}.item{padding:9px 10px;border-radius:8px;display:flex;gap:8px;align-items:center;margin-bottom:3px;white-space:nowrap}
.item:hover,.item.active{background:var(--panel2)}
.item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.del{border:0;background:none;color:var(--muted);padding:2px 5px}
.footer{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px;white-space:nowrap}.footer-actions{display:flex;align-items:center;gap:4px}.btn-danger{border:0;background:none;color:var(--danger);padding:4px 6px;font-size:12px}.btn-danger:hover{text-decoration:underline}
.main{min-width:0;flex:1;display:flex;flex-direction:column;position:relative;z-index:1}
.top{min-height:52px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:8px 14px}
.top-left{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.top-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
.top select{background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:6px 8px;max-width:160px}
.icon-btn{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:6px 10px;color:var(--muted);position:relative;z-index:40;flex-shrink:0}
.icon-btn:hover{color:var(--text);border-color:#3a4654}
.title-wrap{min-width:0;overflow:hidden}
.title-wrap strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.stats{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:11px;color:var(--muted);margin-top:2px}
.stats b{color:var(--text);font-weight:600}
.messages{flex:1;overflow:auto;padding:20px max(12px,calc((100% - 920px)/2))}
.msg{margin:0 auto 20px;max-width:920px}
.role{font-size:12px;color:var(--muted);margin-bottom:5px}
.bubble{white-space:pre-wrap;overflow-wrap:anywhere}
.bubble code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0a0d10;border:1px solid var(--line);border-radius:5px;padding:2px 4px}
.bubble pre{white-space:pre;overflow:auto;background:#080a0d;border:1px solid var(--line);padding:12px;border-radius:8px}.bubble p{margin:.6em 0}
.msg-meta{margin-top:8px;font-size:11px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px 14px}
.msg-meta span{opacity:.95}
.reasoning{margin:8px 0 10px;border:1px solid var(--line);border-radius:10px;background:#0c1015;overflow:hidden}
.reasoning summary{cursor:pointer;padding:8px 12px;color:var(--accent);font-size:12px;user-select:none;list-style:none}
.reasoning summary::-webkit-details-marker{display:none}
.reasoning summary::before{content:"▸ ";}
.reasoning[open] summary::before{content:"▾ ";}
.reasoning-body{padding:0 12px 12px;color:#b7c2ce;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;border-top:1px solid var(--line)}
.composer{padding:10px 14px;border-top:1px solid var(--line)}
.ctxbar{max-width:920px;margin:0 auto 8px;height:5px;background:#1a222b;border-radius:99px;overflow:hidden}
.ctxfill{height:100%;background:linear-gradient(90deg,var(--ok),var(--accent));transition:width .25s;width:0%}
.ctxfill.warn{background:linear-gradient(90deg,var(--warn),#f87171)}
.form{max-width:920px;margin:auto;display:flex;align-items:flex-end;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px}
.form textarea{flex:1;resize:none;background:transparent;border:0;outline:0;min-height:44px;max-height:180px;padding:7px}.form-side{display:flex;flex-direction:column;gap:6px;flex-shrink:0}.form select,.form .send{height:40px;min-width:108px;border-radius:8px;padding:0 12px;font-size:13px;border:1px solid var(--line);box-sizing:border-box}.form select{background:var(--panel2);color:var(--text)}.form .send{background:#eef2f7;color:#111;border:0;font-weight:600}.form .send:disabled{opacity:.5;cursor:not-allowed}
.send{align-self:flex-end;background:#eef2f7;color:#111;border:0;border-radius:8px;padding:9px 14px}
.send:disabled{opacity:.5;cursor:not-allowed}
.login{min-height:100dvh;display:grid;place-items:center;padding:20px}
.card{width:min(380px,100%);background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:24px}
.card h1{margin-top:0}.field{display:block;margin:14px 0}
.field input{width:100%;padding:11px;border-radius:8px;border:1px solid var(--line);background:#0b0e12;outline:0}
.login button{width:100%;padding:11px;border:0;border-radius:8px;background:#eef2f7;color:#111}
.error{color:#ff9b9b;margin-bottom:10px}
.scrim{display:none;position:fixed;inset:0;background:#0008;z-index:25}
@media(max-width:700px){
  .sidebar{position:fixed;left:0;top:0;bottom:0;width:min(86vw,300px);transform:translateX(0);box-shadow:8px 0 28px #000a}
  .sidebar.collapsed{transform:translateX(-105%);width:min(86vw,300px);padding:14px;border-right:1px solid var(--line);overflow:hidden;pointer-events:none}
  .sidebar:not(.collapsed){pointer-events:auto}
  .brand .close-sb{display:inline-block}
  .scrim.show{display:block}
  .messages{padding:16px 12px}
  .top{padding:8px 10px}
  .top select{max-width:130px;font-size:12px}
  .stats{font-size:10px;gap:4px 8px}
}
</style></head><body>${body}${scripts}</body></html>`;
}

function loginPage(error = "") {
  return page(
    "Login",
    `<div class="login"><form class="card" method="post" action="/login">
<h1>Private AI Chat</h1><p style="color:var(--muted)">Admin sign in</p>
${error ? `<div class="error">${esc(error)}</div>` : ""}
<label class="field">Username<input name="username" autocomplete="username" maxlength="128" required></label>
<label class="field">Password<input type="password" name="password" autocomplete="current-password" maxlength="256" required></label>
<button>Sign in</button></form></div>`
  );
}

function appPage() {
  const body = `<div class="scrim" id="scrim"></div>
<div class="shell">
<aside class="sidebar collapsed" id="sidebar">
  <div class="brand"><span>Private AI Chat</span><button type="button" class="close-sb" id="closeSidebar" aria-label="关闭">✕</button></div>
  <button class="new" id="newChat">＋ New Chat</button>
  <div class="history" id="history"></div>
  <div class="footer"><span>Admin</span><div class="footer-actions"><button type="button" class="btn-danger" id="deleteAll">Delete all</button><button type="button" class="del" id="logout">Logout</button></div></div>
</aside>
<main class="main">
  <header class="top">
    <div class="top-left">
      <button type="button" class="icon-btn" id="toggleSidebar" title="菜单" aria-label="菜单">☰</button>
      <div class="title-wrap">
        <strong id="title">New Chat</strong>
        <div class="stats" id="stats">
          <span>总思考 <b id="stThinkTotal">—</b></span>
          <span>总 Token <b id="stTokTotal">—</b></span>
          <span>上下文 <b id="stCtx">0</b></span>
        </div>
      </div>
    </div>
  </header>
  <section class="messages" id="messages">
    <div class="msg"><div class="role">Assistant</div><div class="bubble">你好，有什么可以帮你的？</div></div>
  </section>
  <div class="composer">
    <div class="ctxbar" title="上下文占用"><div class="ctxfill" id="ctxfill"></div></div>
    <form class="form" id="form">
      <textarea id="input" maxlength="${MAX_MESSAGE}" placeholder="输入消息…"></textarea>
      <div class="form-side">
        <select id="model" title="模型">
          <option value="deepseek-ai/DeepSeek-V3.2">DeepSeek-V3.2</option>
          <option value="deepseek-ai/DeepSeek-R1">DeepSeek-R1</option>
        </select>
        <button type="submit" class="send" id="sendBtn">发送</button>
      </div>
    </form>
  </div>
</main>
</div>`;

  const script = `<script>
const $=s=>document.querySelector(s);
const historyEl=$('#history'), messagesEl=$('#messages'), input=$('#input'), sendBtn=$('#sendBtn');
const sidebar=$('#sidebar'), scrim=$('#scrim');
const MODEL_CTX={"deepseek-ai/DeepSeek-V3.2":128000,"deepseek-ai/DeepSeek-R1":163840};
let currentId=null, currentModel='deepseek-ai/DeepSeek-V3.2', csrfToken='';
let sessionMeta={totalThinkingMs:0,totalPromptTokens:0,totalCompletionTokens:0,totalTokens:0,ctxTokens:0};
let sending=false;
function setSending(v){sending=!!v;sendBtn.disabled=sending;}

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
  if(ms==null||ms<0||!isFinite(ms))return '—';
  if(ms<1000)return Math.round(ms)+'ms';
  return (ms/1000).toFixed(1)+'s';
}
function fmtTok(n){
  if(n==null||!isFinite(n))return '—';
  if(n>=1000)return (n/1000).toFixed(1)+'k';
  return String(Math.round(n));
}
function updateStats(){
  $('#stThinkTotal').textContent=fmtMs(sessionMeta.totalThinkingMs);
  $('#stTokTotal').textContent=fmtTok(sessionMeta.totalTokens);
  const limit=MODEL_CTX[currentModel]||128000;
  const pct=Math.min(100,Math.round((sessionMeta.ctxTokens/limit)*1000)/10);
  $('#stCtx').textContent=fmtTok(sessionMeta.ctxTokens)+' / '+fmtTok(limit)+' ('+pct+'%)';
  const fill=$('#ctxfill');
  fill.style.width=pct+'%';
  fill.classList.toggle('warn',pct>=75);
}
function openSidebar(){sidebar.classList.remove('collapsed');scrim.classList.add('show');}
function closeSidebar(){sidebar.classList.add('collapsed');scrim.classList.remove('show');}
function toggleSidebar(){
  if(sidebar.classList.contains('collapsed'))openSidebar();
  else closeSidebar();
}
$('#toggleSidebar').onclick=toggleSidebar;
$('#closeSidebar').onclick=closeSidebar;
scrim.onclick=closeSidebar;

function renderMsg(role,content,meta){
  meta=meta||{};
  const d=document.createElement('div');d.className='msg';
  let reasoningHtml='';
  if(meta.reasoning){
    reasoningHtml='<details class="reasoning"><summary>思维链（DeepSeek-R1）</summary><div class="reasoning-body">'+esc(meta.reasoning)+'</div></details>';
  }
  const bits=[];
  if(meta.thinkingMs!=null)bits.push('<span>思考 '+fmtMs(meta.thinkingMs)+'</span>');
  if(meta.totalTokens!=null)bits.push('<span>Token '+fmtTok(meta.totalTokens)+'（↑'+fmtTok(meta.promptTokens)+' / ↓'+fmtTok(meta.completionTokens)+'）</span>');
  else if(meta.promptTokens!=null||meta.completionTokens!=null)bits.push('<span>Token ↑'+fmtTok(meta.promptTokens)+' / ↓'+fmtTok(meta.completionTokens)+'</span>');
  const metaHtml=bits.length?'<div class="msg-meta">'+bits.join('')+'</div>':'';
  d.innerHTML='<div class="role">'+(role==='user'?'You':'Assistant')+'</div>'+reasoningHtml+'<div class="bubble"></div>'+metaHtml;
  const bubble=d.querySelector('.bubble');
  if(role==='assistant')bubble.innerHTML=md(content||'');
  else bubble.innerHTML=esc(content||'').replace(/\\n/g,'<br>');
  messagesEl.appendChild(d);
  messagesEl.scrollTop=messagesEl.scrollHeight;
  return {root:d,bubble,setMeta(m){
    let el=d.querySelector('.msg-meta');
    if(!el){el=document.createElement('div');el.className='msg-meta';d.appendChild(el);}
    const b=[];
    if(m.thinkingMs!=null)b.push('<span>思考 '+fmtMs(m.thinkingMs)+'</span>');
    if(m.totalTokens!=null)b.push('<span>Token '+fmtTok(m.totalTokens)+'（↑'+fmtTok(m.promptTokens)+' / ↓'+fmtTok(m.completionTokens)+'）</span>');
    el.innerHTML=b.join('');
  },setReasoning(text,open){
    let details=d.querySelector('.reasoning');
    if(!details){
      details=document.createElement('details');
      details.className='reasoning';
      details.innerHTML='<summary>思维链（DeepSeek-R1）</summary><div class="reasoning-body"></div>';
      d.insertBefore(details,d.querySelector('.bubble'));
    }
    if(open)details.open=true;
    details.querySelector('.reasoning-body').textContent=text||'';
    const sum=details.querySelector('summary');
    if(sum)sum.textContent=open?'思维链（思考中…）':'思维链（DeepSeek-R1）';
  }};
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
    d.querySelector('span').onclick=()=>{openChat(c.id);closeSidebar();};
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
  sessionMeta.ctxTokens=(c.messages||[]).reduce((n,m)=>n+Math.ceil(((m.content||'')+(m.reasoning||'')).length/2)+4,0);
  updateStats();
  loadChats();
}
function newChat(){
  currentId=null;
  $('#title').textContent='New Chat';
  messagesEl.innerHTML='<div class="msg"><div class="role">Assistant</div><div class="bubble">你好，有什么可以帮你的？</div></div>';
  sessionMeta={totalThinkingMs:0,totalPromptTokens:0,totalCompletionTokens:0,totalTokens:0,ctxTokens:0};
  updateStats();
  loadChats();
  closeSidebar();
}
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
  if(!text||sending)return;
  input.value='';
  setSending(true);
  renderMsg('user',text);
  const ui=renderMsg('assistant','');
  const t0=performance.now();
  let reasoning='';
  let content='';
  try{
    const res=await postJSON('/api/chat',{chatId:currentId,model:currentModel,message:text});
    if(!res.ok){
      ui.bubble.textContent=await res.text();
      setSending(false);
      return;
    }
    const reader=res.body.getReader(),dec=new TextDecoder();
    let buf='';
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
            ui.setReasoning(reasoning,true);
            messagesEl.scrollTop=messagesEl.scrollHeight;
          }
          if(j.delta){
            content+=j.delta;
            ui.bubble.textContent=content;
            messagesEl.scrollTop=messagesEl.scrollHeight;
          }
          if(j.done){
            if(j.title)$('#title').textContent=j.title;
            if(j.sessionTotalThinkingMs!=null)sessionMeta.totalThinkingMs=j.sessionTotalThinkingMs;
            if(j.sessionTotalTokens!=null)sessionMeta.totalTokens=j.sessionTotalTokens;
            if(j.sessionTotalPromptTokens!=null)sessionMeta.totalPromptTokens=j.sessionTotalPromptTokens;
            if(j.sessionTotalCompletionTokens!=null)sessionMeta.totalCompletionTokens=j.sessionTotalCompletionTokens;
            if(j.ctxTokens!=null)sessionMeta.ctxTokens=j.ctxTokens;
            const think=j.thinkingMs!=null?j.thinkingMs:Math.round(performance.now()-t0);
            ui.setMeta({
              thinkingMs:think,
              promptTokens:j.promptTokens,
              completionTokens:j.completionTokens,
              totalTokens:j.totalTokens
            });
            if(reasoning)ui.setReasoning(reasoning,false);
            updateStats();
          }
        }catch{}
      }
    }
    if(content)ui.bubble.innerHTML=md(content);
    else if(!ui.bubble.textContent)ui.bubble.textContent='（空回复）';
    // 若流结束仍无 done 元数据，用本地时间补全本轮思考
    if(!ui.root.querySelector('.msg-meta')){
      ui.setMeta({thinkingMs:Math.round(performance.now()-t0)});
    }
    loadChats();
  }catch(err){
    ui.bubble.textContent='请求失败：'+(err&&err.message?err.message:String(err));
  }finally{
    setSending(false);
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

async function sf(env: Env, messages: any[], model: string, stream: boolean, extra: Record<string, unknown> = {}) {
  const body: any = {
    model,
    messages,
    stream,
    temperature: model.includes("R1") ? 0.6 : 0.7,
    ...extra,
  };
  if (stream) body.stream_options = { include_usage: true };
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

/** 关闭 thinking，避免 Qwen3.5 标题/压缩只返回 reasoning 为空 */
async function sfText(env: Env, messages: any[], model: string): Promise<string> {
  const r = await sf(env, messages, model, false, {
    enable_thinking: false,
    max_tokens: 512,
  });
  const j: any = await r.json();
  const msg = j.choices?.[0]?.message || {};
  let text = String(msg.content || "").trim();
  if (!text && msg.reasoning_content) text = String(msg.reasoning_content).trim();
  return text;
}

async function generateTitle(env: Env, messages: ChatMessage[]) {
  try {
    const snippet = messages
      .filter(x => x.role === "user" || x.role === "assistant")
      .slice(0, 4)
      .map(x => `${x.role}: ${(x.content || "").slice(0, 300)}`)
      .join("\n");
    const text = await sfText(
      env,
      [
        {
          role: "user",
          content:
            "根据下面对话生成一个简短中文标题。只输出标题本身，不要引号、不要解释，不超过16个字。\n\n" +
            (snippet || "新对话"),
        },
      ],
      MODEL_TITLE
    );
    let title = text.replace(/^["'「『]|["'」』]$/g, "").replace(/\n/g, " ").trim().slice(0, 30);
    if (!title) {
      const firstUser = messages.find(m => m.role === "user");
      title = (firstUser?.content || "新对话").replace(/\s+/g, " ").slice(0, 16);
    }
    return title || "新对话";
  } catch (e) {
    console.error("generateTitle failed", e);
    const firstUser = messages.find(m => m.role === "user");
    return (firstUser?.content || "新对话").replace(/\s+/g, " ").slice(0, 16);
  }
}

async function compressasync function compressMessages(env: Env, messages: ChatMessage[]): Promise<ChatMessage[]> {
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
    const summary = (
      await sfText(
        env,
        [
          {
            role: "user",
            content:
              "将以下多轮对话压缩成简洁中文摘要，保留关键事实、用户偏好、未完成任务与重要结论。只输出摘要正文，不要前言。\n\n" +
              text,
          },
        ],
        MODEL_HELPER
      )
    ).slice(0, 2000);
    if (!summary) return messages;
    return [...system, { role: "system", content: "【历史对话摘要】\n" + summary }, ...keepTail];
  } catch (e) {
    console.error("compress failed", e);
    return [...system, ...rest.slice(-MAX_MESSAGES)];
  }
}

async function needSearchasync function needSearch(question: string) {
  return /(现在|搜索|查一下|查一查|查下|搜一下|搜一搜|联网|百度|谷歌|最新|今天|近期|目前|新闻|价格|天气|比赛|发布|更新|多少钱|怎么样了|什么情况|202[4-9]|latest|today|news|price|weather|search)/i.test(
    question
  );
}

async function buildSearchQuery(env: Env, question: string) {
  try {
    const text = await sfText(
      env,
      [
        {
          role: "user",
          content: "把用户问题改写成适合网页搜索的简短关键词。只输出搜索词，不要解释。\n\n问题：" + question,
        },
      ],
      MODEL_HELPER
    );
    return (text || question).trim().slice(0, 300);
  } catch {
    return question.slice(0, 300);
  }
}

async function webSearchasync function webSearch(env: Env, query: string) {
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
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      totalThinkingMs: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
    };
  } else {
    // 确保旧会话也有真实 system prompt
    const sysIdx = chat.messages.findIndex(m => m.role === "system" && !m.content.startsWith("【历史对话摘要】"));
    if (sysIdx >= 0) chat.messages[sysIdx].content = SYSTEM_PROMPT;
    else chat.messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }
  chat.model = model;
  chat.messages.push({ role: "user", content: message });

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

  // 先保存用户消息（若后续流失败至少保留提问）
  try {
    await persistChat(c.env, chat);
  } catch (e) {
    console.error("persist user failed", e);
  }

  const context = await searchContext(c.env, message);
  const upstreamMessages: any[] = chat.messages.map(m => {
    const o: any = { role: m.role, content: m.content };
    if (m.reasoning && model.includes("R1")) o.reasoning_content = m.reasoning;
    return o;
  });
  if (context) {
    upstreamMessages.push({
      role: "system",
      content: "以下是网页搜索结果，可在有用时参考，不要声称自己浏览了网页：\n" + context,
    });
  }

  const started = Date.now();
  let r: Response;
  try {
    const extra: Record<string, unknown> = {};
    if (model.includes("R1")) extra.thinking_budget = 8192;
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
  let finalized = false;

  const finalize = async (partial: boolean) => {
    if (finalized) return null;
    finalized = true;
    const thinkingMs = Date.now() - started;
    const promptTokens = usage?.prompt_tokens ?? estimateTokens(JSON.stringify(upstreamMessages));
    const completionTokens = usage?.completion_tokens ?? estimateTokens(assistant) + estimateTokens(reasoning);
    const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;

    const asstMsg: ChatMessage = {
      role: "assistant",
      content: assistant || (partial ? "(interrupted)" : ""),
      thinkingMs,
      promptTokens,
      completionTokens,
      totalTokens,
    };
    if (reasoning) asstMsg.reasoning = reasoning;

    // 避免重复追加
    const last = chat!.messages[chat!.messages.length - 1];
    if (!(last && last.role === "assistant" && last.content === asstMsg.content)) {
      chat!.messages.push(asstMsg);
    } else {
      chat!.messages[chat!.messages.length - 1] = asstMsg;
    }

    chat!.totalThinkingMs = (chat!.totalThinkingMs || 0) + thinkingMs;
    chat!.totalPromptTokens = (chat!.totalPromptTokens || 0) + promptTokens;
    chat!.totalCompletionTokens = (chat!.totalCompletionTokens || 0) + completionTokens;
    chat!.totalTokens = (chat!.totalTokens || 0) + totalTokens;

    const needTitle = !chat!.title || chat!.title === "New Chat" || chat!.title === "新对话";
    if (needTitle) {
      try {
        chat!.title = await generateTitle(c.env, chat!.messages);
      } catch {
        chat!.title = message.slice(0, 16) || "新对话";
      }
    }

    try {
      await persistChat(c.env, chat!);
    } catch (e) {
      console.error("persist assistant failed", e);
    }

    const ctxTokens = messagesTokenEstimate(chat!.messages);
    return {
      thinkingMs,
      promptTokens,
      completionTokens,
      totalTokens,
      sessionTotalThinkingMs: chat!.totalThinkingMs,
      sessionTotalTokens: chat!.totalTokens,
      sessionTotalPromptTokens: chat!.totalPromptTokens,
      sessionTotalCompletionTokens: chat!.totalCompletionTokens,
      ctxTokens,
      title: chat!.title,
      chatId: id,
    };
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {}
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
              // ignore
            }
          }
        }

        const meta = await finalize(false);
        if (meta) {
          send({ done: true, ...meta });
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (e) {
        console.error("stream error", e);
        try {
          const meta = await finalize(true);
          if (meta) send({ done: true, ...meta });
        } catch {}
        send({ error: "Upstream error" });
        try {
          controller.close();
        } catch {}
      }
    },
    async cancel() {
      try {
        await finalize(true);
      } catch {}
      try {
        reader.cancel();
      } catch {}
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
