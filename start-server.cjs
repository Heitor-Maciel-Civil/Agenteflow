'use strict';
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const url = 'http://127.0.0.1:4455';
const serverPath = path.join(__dirname, 'codex-flow.js');

function probe() {
  return new Promise(resolve => {
    const req = http.get(url + '/api/sessions', res => {
      let text = '';
      res.on('data', data => { if (text.length < 2000000) text += data; });
      res.on('end', () => {
        try { const rows = JSON.parse(text); resolve(res.statusCode === 200 && Array.isArray(rows) && rows.every(row => typeof row.f === 'string')); }
        catch { resolve(false); }
      });
    });
    req.setTimeout(2500, () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

async function main() {
  console.log('Codex Flow: iniciando verificacao do servidor local...');
  let child = null, busy = false, failures = 0, stopped = false, ready = false;
  const stop = () => { stopped = true; if (child) child.kill(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  async function ensure() {
    if (busy || stopped) return;
    busy = true;
    try {
      if (await probe()) {
        if (!ready) console.log('Codex Flow pronto: http://localhost:4455 (servidor ativo reutilizado quando existente)');
        ready = true; failures = 0; return;
      }
      ready = false;
      if (child) return;
      if (failures >= 3) throw new Error('Servidor indisponivel apos tres tentativas. Confira a porta 4455 e a saida acima.');
      failures++;
      console.log('Iniciando Node: ' + serverPath);
      child = spawn(process.execPath, [serverPath], {
        cwd: __dirname, stdio: 'inherit', windowsHide: true,
        env: { ...process.env, PORT: '4455' }
      });
      child.once('error', error => { console.error(error.message); child = null; });
      child.once('exit', () => { child = null; });
    } finally { busy = false; }
  }
  await ensure();
  const timer = setInterval(() => ensure().catch(error => {
    console.error(error.message); clearInterval(timer); process.exitCode = 1;
  }), 3000);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { probe };
