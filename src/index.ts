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
type ChatMessage = { role: Role; content: string };
type ChatRecord = {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

const app = new Hono<{ Bindings: Env }>();
const SESSION_TTL = 60 * 60 * 24 * 7;
const CHAT_TTL = 60 * 60 * 24 * 7;
const MAX_MESSAGE = 12000;
const MAX_MESSAGES = 80;
const MODELS = ["deepseek-ai/DeepSeek-V3.2", "deepseek-ai/DeepSeek-R1"] as const;

function esc(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!));
}

function page(title: string, body: string, scripts = "") {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark;--bg:#0b0d10;--panel:#11151a;--panel2:#171c22;--line:#27303a;--text:#eef2f7;--muted:#9aa6b2}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}
.shell{height:100dvh;display:flex}.sidebar{width:280px;background:#0e1115;border-right:1px solid var(--line);padding:14px;display:flex;flex-direction:column;gap:12px}
.brand{font-weight:700;font-size:16px}.new{width:100%;border:1px solid var(--line);background:var(--panel2);border-radius:9px;padding:10px;text-align:left}
.history{overflow:auto;flex:1}.item{padding:9px 10px;border-radius:8px;display:flex;gap:8px;align-items:center;margin-bottom:3px}.item:hover,.item.active{background:var(--panel2)}
.item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.del{border:0;background:none;color:var(--muted);padding:2px 5px}.footer{display:flex;justify-content:space-between;color:var(--muted);font-size:12px}
.main{min-width:0;flex:1;display:flex;flex-direction:column}.top{height:56px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:0 18px}
.top select{background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:6px 8px;margin-left:auto}
.messages{flex:1;overflow:auto;padding:24px max(16px,calc((100% - 900px)/2));}.msg{margin:0 auto 22px;max-width:900px}
.role{font-size:12px;color:var(--muted);margin-bottom:5px}.bubble{white-space:pre-wrap;overflow-wrap:anywhere}
.bubble code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0a0d10;border:1px solid var(--line);border-radius:5px;padding:2px 4px}
.bubble pre{white-space:pre;overflow:auto;background:#080a0d;border:1px solid var(--line);padding:12px;border-radius:8px}.bubble p{margin:.6em 0}
.composer{padding:12px 16px;border-top:1px solid var(--line)}.form{max-width:900px;margin:auto;display:flex;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px}
.form textarea{flex:1;resize:none;background:transparent;border:0;outline:0;min-height:44px;max-height:180px;padding:7px}
.send{align-self:flex-end;background:#eef2f7;color:#111;border:0;border-radius:8px;padding:9px 14px}
.login{min-height:100dvh;display:grid;place-items:center;padding:20px}.card{width:min(380px,100%);background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:24px}
.card h1{margin-top:0}.field{display:block;margin:14px 0}.field input{width:100%;padding:11px;border-radius:8px;border:1px solid var(--line);background:#0b0e12;outline:0}
.login button{width:100%;padding:11px;border:0;border-radius:8px;background:#eef2f7;color:#111}.error{color:#ff9b9b;margin-bottom:10px}
@media(max-width:700px){.sidebar{width:220px}.messages{padding:18px 12px}.top{padding:0 10px}}
@media(max-width:520px){.sidebar{width:180px;padding:9px}.item{padding:8px 5px}.new{padding:8px}.footer{display:none}}
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
<aside class="sidebar"><div class="brand">Private AI Chat</div><button class="new" id="newChat">＋ New Chat</button><button class="new" id="deleteAll">Delete all chats</button>
<div class="history" id="history"></div><div class="footer"><span>Admin</span><button class="del" id="logout">Logout</button></div></aside>
<main class="main"><header class="top"><strong id="title">New Chat</strong><select id="model">
<option value="deepseek-ai/DeepSeek-V3.2">DeepSeek-V3.2</option>
<option value="deepseek-ai/DeepSeek-R1">DeepSeek-R1</option></select></header>
<section class="messages" id="messages"><div class="msg"><div class="role">Assistant</div><div class="bubble">你好，我是你的私人 AI 助手。有什么想聊的吗？</div></div></section>
<div class="composer"><form class="form" id="form"><textarea id="input" maxlength="${MAX_MESSAGE}" placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"></textarea><button class="send">发送</button></form></div></main></div>`;

  const script = `<script>
const $=s=>document.querySelector(s), historyEl=$('#history'), messagesEl=$('#messages'), input=$('#input');
let currentId=null, currentModel='deepseek-ai/DeepSeek-V3.2';
function esc(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));}
function md(s){
 let x=esc(s);
 x=x.replace(/\\\`\\\`\\\`([\\s\\S]*?)\\\`\\\`\\\`/g,'<pre><code>$1</code></pre>');
 x=x.replace(/\\\`([^\\\`]+)\\\`/g,'<code>$1</code>');
 x=x.replace(/^### (.*)$/gm,'<strong>$1</strong>').replace(/^## (.*)$/gm,'<strong>$1</strong>').replace(/^# (.*)$/gm,'<strong>$1</strong>');
 x=x.replace(/\\*\\*(.*?)\\*\\*/g,'<strong>$1</strong>');
 x=x.replace(/\\n\\n/g,'</p><p>').replace(/\\n/g,'<br>');
 return '<p>'+x+'</p>';
}
function renderMsg(role,content){
 const d=document.createElement('div');d.className='msg';
 d.innerHTML='<div class="role">'+(role==='user'?'You':'Assistant')+'</div><div class="bubble"></div>';
 d.querySelector('.bubble').innerHTML=role==='assistant'?md(content):esc(content).replace(/\\n/g,'<br>');
 messagesEl.appendChild(d);messagesEl.scrollTop=messagesEl.scrollHeight;return d.querySelector('.bubble');
}
let csrfToken="";\nasync function initSecurity(){const r=await fetch("/api/security");if(r.ok){const j=await r.json();csrfToken=j.csrf}}\nasync function postJSON(url,body){return fetch(url,{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken},body:JSON.stringify(body)})}\nasync function deleteReq(url){return fetch(url,{method:"DELETE",headers:{"X-CSRF-Token":csrfToken}})}\nasync function loadChats(){
 const r=await fetch('/api/chats');if(!r.ok)return;const xs=await r.json();historyEl.innerHTML='';
 xs.forEach(c=>{const d=document.createElement('div');d.className='item'+(c.id===currentId?' active':'');
 d.innerHTML='<span>'+esc(c.title||'New Chat')+'</span><button class="del">×</button>';
 d.querySelector('span').onclick=()=>openChat(c.id);
 d.querySelector('.del').onclick=async e=>{e.stopPropagation();await deleteReq('/api/chats/'+encodeURIComponent(c.id));if(c.id===currentId)newChat();loadChats()};
 historyEl.appendChild(d)});
}
async function openChat(id){
 const r=await fetch('/api/chats/'+encodeURIComponent(id));if(!r.ok)return;const c=await r.json();
 currentId=c.id;currentModel=c.model;$('#model').value=c.model;$('#title').textContent=c.title||'New Chat';messagesEl.innerHTML='';
 c.messages.filter(x=>x.role!=='system').forEach(x=>renderMsg(x.role,x.content));loadChats();
}
function newChat(){currentId=null;$('#title').textContent='New Chat';messagesEl.innerHTML='<div class="msg"><div class="role">Assistant</div><div class="bubble">新对话已开始。</div></div>';loadChats()}
$('#newChat').onclick=newChat;$('#model').onchange=e=>currentModel=e.target.value;
$('#deleteAll').onclick=async()=>{if(!confirm('Delete all chat history?'))return;await deleteReq('/api/chats');newChat()};\n$('#logout').onclick=async()=>{await fetch('/logout',{method:'POST',headers:{'X-CSRF-Token':csrfToken}});location='/login'};
$('#form').onsubmit=async e=>{
 e.preventDefault();const text=input.value.trim();if(!text)return;input.value='';renderMsg('user',text);const bubble=renderMsg('assistant','');
 const res=await postJSON('/api/chat',{chatId:currentId,model:currentModel,message:text});
 if(!res.ok){bubble.textContent=await res.text();return}
 const reader=res.body.getReader(),dec=new TextDecoder();let buf='';
 while(true){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const parts=buf.split('\\n\\n');buf=parts.pop()||'';
  for(const p of parts){if(!p.startsWith('data:'))continue;const data=p.slice(5).trim();if(data==='[DONE]')continue;
   try{const j=JSON.parse(data);if(j.chatId)currentId=j.chatId;if(j.delta){bubble.textContent+=j.delta;messagesEl.scrollTop=messagesEl.scrollHeight}}catch{}}
 }
 bubble.innerHTML=md(bubble.textContent);loadChats();
};
input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#form').requestSubmit()}};
loadChats();
</script>`;
  return page("Private AI Chat", body, script);
}

async function sha256(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

async function sessionUser(c: any) {
  const token=getCookie(c,"session");if(!token)return false;
  return !!await c.env.CHAT_KV.get(`session:${await sha256(token)}`);
}

async function rateLimited(env: Env, ip: string) {
  const key=`rl:login:${await sha256(ip)}`, n=Number(await env.CHAT_KV.get(key)||"0");
  if(n>=8)return true;await env.CHAT_KV.put(key,String(n+1),{expirationTtl:900});return false;
}

async function sf(env: Env, messages: ChatMessage[], model: string, stream: boolean) {
  const r=await fetch("https://api.siliconflow.cn/v1/chat/completions",{
    method:"POST",headers:{Authorization:`Bearer ${env.SILICONFLOW_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model,messages,stream,temperature:0.7})
  });
  if(!r.ok)throw new Error(`SiliconFlow HTTP ${r.status}`);return r;
}

async function generateTitle(env: Env, messages: ChatMessage[]) {
  try{
    const r=await sf(env,[
      {role:"system",content:"根据对话内容生成一个简短中文话题名。只输出标题，不要引号，不超过20个字。"},
      {role:"user",content:messages.filter(x=>x.role!=="system").slice(-6).map(x=>`${x.role}: ${x.content}`).join("\n")}
    ],"Qwen/Qwen3.5-9B",false);
    const j:any=await r.json();return String(j.choices?.[0]?.message?.content||"新对话").trim().slice(0,30)||"新对话";
  }catch{return "新对话";}
}

async function needSearch(question: string) {
  return /\b(最新|今天|近期|现在|新闻|价格|天气|比赛|发布|更新|2026|latest|today|news|price|weather)\b/i.test(question);
}

async function buildSearchQuery(env: Env, question: string) {
  try{
    const r=await sf(env,[{role:"system",content:"把用户问题改写成适合网页搜索的简短关键词。只输出搜索词，不要解释。"},
      {role:"user",content:question}],"Qwen/Qwen3.5-35B-A3B",false);
    const j:any=await r.json();return String(j.choices?.[0]?.message?.content||question).trim().slice(0,300);
  }catch{return question.slice(0,300);}
}

async function webSearch(env: Env, query: string) {
  // No API key is required. DuckDuckGo's public HTML endpoint is used as a
  // lightweight search fallback suitable for a Cloudflare Worker.
  const endpoints = [
    env.WEB_SEARCH_URL || "https://html.duckduckgo.com/html/",
    "https://lite.duckduckgo.com/lite/"
  ];

  for (const base of endpoints) {
    try {
      const u = new URL(base);
      u.searchParams.set("q", query);
      u.searchParams.set("kl", "cn-zh");
      const r = await fetch(u.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PrivateAIChat/1.0; +https://workers.cloudflare.com/)",
          "Accept": "text/html,application/xhtml+xml"
        },
        redirect: "follow"
      });
      if (!r.ok) continue;

      const html = await r.text();
      const results = parseDuckDuckGoResults(html, u.origin);
      if (results.length) return results;
    } catch {
      // Try the next free endpoint.
    }
  }
  return [];
}

function parseDuckDuckGoResults(html: string, origin: string) {
  const results: { name: string; url: string; snippet: string }[] = [];
  const seen = new Set<string>();

  // HTML endpoint: result__a / result__snippet
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

  // Lite endpoint: links use result-link and snippets are in result-snippet.
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
    return /^https?:\/\//i.test(url) && !/^https?:\/\/(?:www\.)?(?:duckduckgo\.com|html\.duckduckgo\.com|lite\.duckduckgo\.com)\//i.test(url)
      ? url
      : "";
  } catch {
    return "";
  }
}

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

async function searchContext(env: Env, question: string) {
  if(!(await needSearch(question)))return "";
  const q=await buildSearchQuery(env,question),results=await webSearch(env,q);
  if(!results.length)return "";
  return "\n\n网页搜索结果（仅作为参考）：\n"+results.map((x:any,i:number)=>`${i+1}. ${x.name}\n${x.snippet}\n${x.url}`).join("\n");
}

const chatKey=(id:string)=>`chat:admin:${id}`;
const indexKey=()=>`chats:admin`;

async function saveIndex(env: Env,id:string,title:string,updatedAt:number) {
  const raw=await env.CHAT_KV.get(indexKey()),xs:any[]=raw?JSON.parse(raw):[];
  const next=xs.filter(x=>x.id!==id);next.unshift({id,title,updatedAt});
  await env.CHAT_KV.put(indexKey(),JSON.stringify(next.slice(0,100)),{expirationTtl:CHAT_TTL});
}

app.get("/",c=>c.redirect("/chat"));
app.get("/login",c=>c.html(loginPage()));
app.post("/login",async c=>{
  const ip=c.req.header("CF-Connecting-IP")||"unknown";
  if(await rateLimited(c.env,ip))return c.html(loginPage("Too many login attempts. Try again later."),429);
  const form=await c.req.parseBody(),u=String(form.username||""),p=String(form.password||"");
  if(u!==c.env.ADMIN_USERNAME||p!==c.env.ADMIN_PASSWORD)return c.html(loginPage("Invalid credentials."),401);
  const token=crypto.randomUUID()+crypto.randomUUID();
  const csrf=crypto.randomUUID()+crypto.randomUUID();
  await c.env.CHAT_KV.put(`session:${await sha256(token)}`,JSON.stringify({user:"admin",csrf}),{expirationTtl:SESSION_TTL});
  setCookie(c,"session",token,{httpOnly:true,secure:true,sameSite:"Lax",path:"/",maxAge:SESSION_TTL});
  return c.redirect("/chat");
});
app.post("/logout",async c=>{
  if(!(await checkCsrf(c)))return c.redirect("/login");
  const token=getCookie(c,"session");if(token)await c.env.CHAT_KV.delete(`session:${await sha256(token)}`);
  deleteCookie(c,"session",{path:"/"});return c.redirect("/login");
});

app.get("/chat",async c=>{if(!(await sessionUser(c)))return c.redirect("/login");return c.html(appPage())});


async function checkCsrf(c: any) {
  const token = getCookie(c, "session");
  const supplied = c.req.header("X-CSRF-Token");
  if (!token || !supplied) return false;
  const raw = await c.env.CHAT_KV.get(`session:${await sha256(token)}`);
  if (!raw) return false;
  try { return JSON.parse(raw).csrf === supplied; } catch { return false; }
}

app.get("/api/security", async c => {
  const token=getCookie(c,"session");
  if(!token)return c.json({error:"Unauthorized"},401);
  const raw=await c.env.CHAT_KV.get(`session:${await sha256(token)}`);
  if(!raw)return c.json({error:"Unauthorized"},401);
  try{return c.json({csrf:JSON.parse(raw).csrf});}catch{return c.json({error:"Unauthorized"},401);}
});

app.get("/api/chats",async c=>{
  if(!(await sessionUser(c)))return c.json({error:"Unauthorized"},401);
  const raw=await c.env.CHAT_KV.get(indexKey());let xs:any[]=raw?JSON.parse(raw):[],alive=[];
  for(const x of xs)if(await c.env.CHAT_KV.get(chatKey(x.id)))alive.push(x);
  if(alive.length!==xs.length)await c.env.CHAT_KV.put(indexKey(),JSON.stringify(alive),{expirationTtl:CHAT_TTL});
  return c.json(alive);
});

app.get("/api/chats/:id",async c=>{
  if(!(await sessionUser(c)))return c.json({error:"Unauthorized"},401);
  const id=c.req.param("id");if(!/^[a-f0-9-]{10,80}$/.test(id))return c.json({error:"Invalid id"},400);
  const x=await c.env.CHAT_KV.get(chatKey(id),"json") as ChatRecord|null;
  return x?c.json(x):c.json({error:"Not found"},404);
});

app.delete("/api/chats/:id",async c=>{
  if(!(await sessionUser(c)))return c.json({error:"Unauthorized"},401);
  if(!(await checkCsrf(c)))return c.json({error:"CSRF validation failed"},403);
  const id=c.req.param("id");await c.env.CHAT_KV.delete(chatKey(id));
  const raw=await c.env.CHAT_KV.get(indexKey());const xs:any[]=raw?JSON.parse(raw):[];
  await c.env.CHAT_KV.put(indexKey(),JSON.stringify(xs.filter(x=>x.id!==id)),{expirationTtl:CHAT_TTL});
  return c.json({ok:true});
});

app.delete("/api/chats",async c=>{
  if(!(await sessionUser(c)))return c.json({error:"Unauthorized"},401);
  if(!(await checkCsrf(c)))return c.json({error:"CSRF validation failed"},403);
  const raw=await c.env.CHAT_KV.get(indexKey());const xs:any[]=raw?JSON.parse(raw):[];
  await Promise.all(xs.map(x=>c.env.CHAT_KV.delete(chatKey(x.id))));
  await c.env.CHAT_KV.delete(indexKey());return c.json({ok:true});
});

app.post("/api/chat",async c=>{
  if(!(await sessionUser(c)))return c.json({error:"Unauthorized"},401);
  if(!(await checkCsrf(c)))return c.json({error:"CSRF validation failed"},403);
  const b=await c.req.json<{chatId?:string;model?:string;message?:string}>();
  const message=String(b.message||"").trim();
  if(!message||message.length>MAX_MESSAGE)return c.text("Invalid message",400);
  const model=MODELS.includes(b.model as any)?b.model!:MODELS[0];
  const id=b.chatId&&/^[a-f0-9-]{10,80}$/.test(b.chatId)?b.chatId:crypto.randomUUID();
  let chat=await c.env.CHAT_KV.get(chatKey(id),"json") as ChatRecord|null;
  if(!chat)chat={id,title:"New Chat",model,messages:[{role:"system",content:"You are a helpful assistant."}],createdAt:Date.now(),updatedAt:Date.now()};
  chat.model=model;chat.messages.push({role:"user",content:message});
  if(chat.messages.length>MAX_MESSAGES)chat.messages=chat.messages.slice(-MAX_MESSAGES);

  const context=await searchContext(c.env,message);
  const upstreamMessages=[...chat.messages];
  if(context)upstreamMessages.push({role:"system",content:"Use the following web search results when useful. Do not claim you browsed if no results are present."+context});

  const r=await sf(c.env,upstreamMessages,model,true),reader=r.body?.getReader();
  if(!reader)throw new Error("No response body");
  const encoder=new TextEncoder();let assistant="",buf="";
  const stream=new ReadableStream({
    async start(controller){
      try{
        while(true){
          const {value,done}=await reader.read();if(done)break;
          buf+=new TextDecoder().decode(value,{stream:true});
          const parts=buf.split("\n");buf=parts.pop()||"";
          for(const line of parts){
            const s=line.trim();if(!s.startsWith("data:"))continue;
            const data=s.slice(5).trim();if(data==="[DONE]")continue;
            try{
              const j:any=JSON.parse(data),d=j.choices?.[0]?.delta?.content;
              if(d){assistant+=d;controller.enqueue(encoder.encode(`data: ${JSON.stringify({delta:d,chatId:id})}\n\n`));}
            }catch{}
          }
        }
        chat!.messages.push({role:"assistant",content:assistant});chat!.updatedAt=Date.now();
        if(chat!.title==="New Chat")chat!.title=await generateTitle(c.env,chat!.messages);
        await c.env.CHAT_KV.put(chatKey(id),JSON.stringify(chat),{expirationTtl:CHAT_TTL});
        await saveIndex(c.env,id,chat.title,chat.updatedAt);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({done:true,chatId:id,title:chat.title})}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));controller.close();
      }catch{controller.enqueue(encoder.encode(`data: ${JSON.stringify({error:"Upstream error"})}\n\n`));controller.close();}
    }
  });
  return new Response(stream,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache","X-Content-Type-Options":"nosniff"}});
});

app.notFound(c=>c.text("Not Found",404));
app.onError((e,c)=>{console.error(e);return c.text("Internal Server Error",500)});
export default app;
