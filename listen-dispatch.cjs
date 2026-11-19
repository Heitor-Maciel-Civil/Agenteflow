#!/usr/bin/env node
const http = require('http');

const args = process.argv.slice(2);
const getArg = (name, def = '') => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const port = Number(getArg('--port', process.env.PORT || 4455));
const provider = getArg('--provider', 'antigravity');
const session = getArg('--session', '');
const since = Number(getArg('--since', Date.now()));
const ttlMs = Number(getArg('--ttl', 3600000));
const startedAt = Date.now();

function reqJson(method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf || 'null')); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function loop() {
  for (;;) {
    if (ttlMs > 0 && Date.now() - startedAt >= ttlMs) {
      console.log(JSON.stringify({ status: 'idle_timeout', ttlMs }));
      process.exit(0);
    }
    try {
      const q = `/api/dispatch/poll?provider=${encodeURIComponent(provider)}&session=${encodeURIComponent(session)}&timeout=25000`;
      const items = await reqJson('GET', q);
      if (Array.isArray(items) && items.length) {
        const fresh = items.filter(it => (it.createdAt || 0) >= since);
        const stale = items.filter(it => (it.createdAt || 0) < since);
        for (const s of stale) {
          await reqJson('POST', '/api/dispatch/ack', { id: s.id, transport: 'stale-skip' }).catch(() => {});
        }
        if (fresh.length) {
          const hit = fresh[0];
          await reqJson('POST', '/api/dispatch/ack', { id: hit.id, transport: 'antigravity-bg-listener' }).catch(() => {});
          console.log(JSON.stringify(hit));
          process.exit(0);
        }
      }
    } catch {
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

loop();
