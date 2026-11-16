// Agent Flow: visualizador em tempo real das sessões de Codex, Antigravity, Claude Code e Copilot CLI.
// Uso: node codex-flow.js   (depois abra http://localhost:4455)
// Hooks locais enviam somente estado normalizado; nada e encaminhado para fora da maquina.
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +process.env.PORT || 4455;
const { defaultRoots, listAllSessions, resolveSession, readProviderBatch, ADAPTERS } = require('./providers/index.cjs');
const ROOTS = defaultRoots();
const ROOT = ROOTS.codex;
const { readBatch } = require('./flow-records.cjs');
const {ImageStore}=require('./image-store.cjs');
const { AgentStatusStore } = require('./agent-status.cjs');
const agentStatusStore = new AgentStatusStore();
const imageStore=new ImageStore(path.join(__dirname,'data','images'));
function sessionCwd(key) {
  const resolved = resolveSession(key, ROOTS);
  if (!resolved || resolved.provider !== 'codex') return process.cwd();
  return ADAPTERS.codex.sessionMeta(resolved.file).cwd || process.cwd();
}
function captureImage(session,record){imageStore.capture(session,record,sessionCwd(session))}
const imageReferences=new Map();
function referencedImage(file,imagePath){const target=imagePath.toLowerCase().replace(/\\+/g,'/'),key=file+'\n'+target;if(imageReferences.has(key))return true;
 const fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(65536);let tail='',found=false;try{for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;const text=tail+buffer.subarray(0,n).toString('utf8').toLowerCase().replace(/\\+/g,'/');if(text.includes(target)){found=true;break}tail=text.slice(-target.length*2)}}finally{fs.closeSync(fd)}if(found){imageReferences.set(key,true);if(imageReferences.size>128)imageReferences.delete(imageReferences.keys().next().value)}return found;}

let latestAt = 0, latestRows = [];
function latest(providerFilter) {
  if (Date.now() - latestAt >= 3000) {
    latestAt = Date.now();
    latestRows = listAllSessions(ROOTS);
  }
  if (!providerFilter || providerFilter === 'all') return latestRows;
  return latestRows.filter(s => s.provider === providerFilter);
}
function isLocalAgentRequest(req) {
  const allowedHosts = ['127.0.0.1', 'localhost'];
  try {
    const host = new URL('http://' + (req.headers.host || ''));
    if (!allowedHosts.includes(host.hostname) || Number(host.port || 80) !== PORT) return false;
    if (!req.headers.origin) return true;
    const origin = new URL(req.headers.origin);
    return origin.protocol === 'http:' &&
      allowedHosts.includes(origin.hostname) &&
      Number(origin.port || 80) === PORT;
  } catch {
    return false;
  }
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if(u.pathname==='/assets/setas.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-cache'});return res.end(fs.readFileSync(path.join(__dirname,'assets','setas.svg')))}
  const pngMatch=u.pathname.match(/^\/assets\/(codex|antigravity|copilot|claude)\.png$/);
  if(pngMatch){res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=3600'});return res.end(fs.readFileSync(path.join(__dirname,'assets',pngMatch[1]+'.png')))}
  if (u.pathname === '/api/agents' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const now = Date.now();
    const snap = agentStatusStore.snapshot().map(p => {
      if (p.status !== 'unknown') return p;
      const recent = latest(p.id)[0];
      if (!recent || now - recent.m > 900000) return p;
      const st = (now - recent.m) < 20000 ? 'running' : 'idle';
      const label = recent.cwd ? path.basename(recent.cwd) : (recent.title || p.name).slice(0, 32);
      return { ...p, status: st, activeCount: 1, sessions: [{ status: st, workspaceName: label, updatedAt: recent.m }] };
    });
    return res.end(JSON.stringify(snap));
  }
  if (u.pathname === '/api/agent-events') {
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end('{}'); }
    if (!isLocalAgentRequest(req)) { res.writeHead(403); return res.end('{}'); }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      res.writeHead(415); return res.end('{}');
    }
    const limit = 8192, length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > limit) { res.writeHead(413); return res.end('{}'); }
    let size = 0, tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { tooLarge = true; chunks.length = 0; return; }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) { res.writeHead(413); return res.end('{}'); }
      let record;
      try { record = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { res.writeHead(400); return res.end('{}'); }
      if (!agentStatusStore.apply(record)) { res.writeHead(400); return res.end('{}'); }
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    });
    req.on('error', () => { if (!res.headersSent) { res.writeHead(400); res.end('{}'); } });
    return;
  }
  if(u.pathname==='/api/resource'){
    const relative=u.searchParams.get('f')||'',resolved=resolveSession(relative,ROOTS),requested=u.searchParams.get('path')||'';
    try{if(!resolved||!requested||!referencedImage(resolved.file,requested))throw Error();const full=path.resolve(sessionCwd(relative),requested),stat=fs.statSync(full);if(!stat.isFile())throw Error();
      const fd=fs.openSync(full,'r'),buffer=Buffer.alloc(Math.min(stat.size,262144));let n;try{n=fs.readSync(fd,buffer,0,buffer.length,0)}finally{fs.closeSync(fd)}if(buffer.subarray(0,n).includes(0))throw Error();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(JSON.stringify({content:buffer.subarray(0,n).toString('utf8'),truncated:stat.size>n}));
    }catch{res.writeHead(404);return res.end('{}')}
  }
  if (u.pathname === '/api/image') {
    const relative=u.searchParams.get('f')||'',resolved=resolveSession(relative,ROOTS),requested=u.searchParams.get('path')||'';
    const ext = path.extname(requested).toLowerCase(), mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp'}[ext];
    try {
      if (!resolved||!requested||!mime) throw Error('invalid');const cwd=sessionCwd(relative);
      const key=u.searchParams.get('k')||'';let cached=imageStore.get(relative,requested,key);if(!cached){if(!referencedImage(resolved.file,requested))throw Error('not referenced');cached=imageStore.preserve(relative,requested,key,cwd)}if(!cached)throw Error('unavailable');
      res.writeHead(200, {'Content-Type':cached.mime,'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'});
      const stream=fs.createReadStream(cached.full);stream.on('error',()=>res.destroy());return stream.pipe(res);
    } catch { res.writeHead(404); return res.end(); }
  }
  if (u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }
  if (u.pathname === '/api/agent') {
    const parent = u.searchParams.get('parent'), agent = u.searchParams.get('agent');
    const findSub = (dir) => {
      let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
      for (const e of es) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { const r = findSub(p); if (r) return r; }
        else if (/^rollout-.*\.jsonl$/.test(e.name)) { const m = ADAPTERS.codex.sessionMeta(p); if (m.parent_thread_id === parent && m.agent_path === agent) return p; }
      }
      return null;
    };
    const file = findSub(ROOT);
    if (!file) { res.writeHead(404); return res.end('{}'); }
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const after=Math.max(0,Number(u.searchParams.get('after'))||0),since=Date.parse(u.searchParams.get('since')||''),state={offset:after,pending:Buffer.alloc(0),onRecord:o=>captureImage(rel,o)},records=[];
    const fileSize=fs.statSync(file).size;
    let ownTurn=u.searchParams.get('own')==='1';
    for(let i=0;i<1024&&records.length===0&&state.offset<fileSize;i++){
      const batch=readBatch(file,state);
      for(const o of batch){
        const p=o.payload||{},attr=p.turn_attribution||p,ts=Date.parse(o.timestamp);
        if(o.type==='event_msg'&&p.type==='task_started'&&attr.root_turn_id&&attr.turn_id!==attr.root_turn_id)ownTurn=true;
        if(Number.isFinite(since)&&Number.isFinite(ts)&&ts<since-2000)continue;
        if(ownTurn&&o.type==='response_item'&&/^(function_call|custom_tool_call|function_call_output|custom_tool_call_output|reasoning)$/.test(p.type))records.push(o);
      }
    }
    const next=state.offset-state.pending.length,caught=next>=fs.statSync(file).size;
    res.writeHead(200, { 'Content-Type':'application/json','Cache-Control':'no-store','X-Flow-Caught-Up':String(caught),'X-Flow-Cursor':String(next),'X-Flow-Own':ownTurn?'1':'0','X-Flow-File':rel });return res.end(JSON.stringify(records));
  }
  if (u.pathname === '/api/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const provider = u.searchParams.get('provider') || 'all';
    return res.end(JSON.stringify(latest(provider).slice(0, 120)));
  }
  if (u.pathname === '/events') {
    let f = u.searchParams.get('f') || '';
    const providerFilter = u.searchParams.get('provider') || 'all';
    const auto = !f;
    if (auto) { const l = latest(providerFilter)[0]; f = l ? l.f : ''; }
    const resolved = resolveSession(f, ROOTS);
    if (!resolved) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('event: empty\ndata: {}\n\n'); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('event: file\ndata: ' + JSON.stringify(f) + '\n\n');
    const state={offset:0,pending:Buffer.alloc(0),onRecord:o=>captureImage(f,o)}; let scheduled=false,sentCaughtUp=false;
    const pump = () => {
      let st; try { st = fs.statSync(resolved.file); } catch { return; }
      if (res.destroyed || res.writableNeedDrain) return;
      if (st.size === state.offset) {
        if (!sentCaughtUp) { sentCaughtUp = true; res.write('event: caught_up\ndata: {}\n\n'); }
        return;
      }
      const records=readProviderBatch(resolved,state);
      if(records.length)res.write('data: '+JSON.stringify(records.map(o=>JSON.stringify(o)))+'\n\n');
      if(state.offset<st.size&&!scheduled&&!res.writableNeedDrain){scheduled=true;setImmediate(()=>{scheduled=false;pump()});}
      else if(state.offset>=st.size&&!sentCaughtUp){sentCaughtUp=true;res.write('event: caught_up\ndata: {}\n\n');}
    };
    pump();
    res.on('drain',pump);
    const t1 = setInterval(pump, 400);
    const t2 = setInterval(() => {
      if (!auto) return;
      const l = latest(providerFilter)[0];
      if (l && l.f !== f) res.write('event: switch\ndata: ' + JSON.stringify(l.f) + '\n\n');
    }, 3000);
    req.on('close', () => { clearInterval(t1); clearInterval(t2); });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => {
  console.log('Agent Flow / Codex Flow rodando em http://localhost:' + PORT);
  console.log('Lendo sessões de: ' + Object.entries(ROOTS).map(([k, v]) => k + '=' + v).join(' | '));
});
