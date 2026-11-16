'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, method, route, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method,
      headers: Object.assign({}, payload ? {
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      } : {}, headers || {})
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

function startServer(port, home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'codex-flow.js')], {
      cwd: __dirname,
      env: Object.assign({}, process.env, {
        PORT: String(port),
        CODEX_HOME: home,
        ANTIGRAVITY_BRAIN: path.join(home, 'ag'),
        COPILOT_SESSIONS: path.join(home, 'cop'),
        CLAUDE_PROJECTS: path.join(home, 'cl')
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '', errors = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Servidor Codex Flow nao iniciou a tempo: ' + errors));
    }, 5000);
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      if (output.includes('Codex Flow rodando')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', chunk => { errors += chunk.toString('utf8'); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      if (code !== null && !output.includes('Codex Flow rodando')) {
        clearTimeout(timer);
        reject(new Error('Servidor encerrou durante a inicializacao: ' + errors));
      }
    });
  });
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    child.once('exit', resolve);
    child.kill();
  });
}

test('API local rejeita origem remota e aceita apenas status sanitizado', async () => {
  const home = fs.mkdtempSync(path.join(__dirname, '.agent-status-server-test-'));
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  const port = await freePort();
  let child;

  try {
    child = await startServer(port, home);
    const empty = await request(port, 'GET', '/api/agents');
    assert.equal(empty.status, 200);
    assert.equal(empty.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(empty.body).every(provider => provider.status === 'unknown'), true);

    const record = {
      provider: 'copilot',
      event: 'userPromptSubmitted',
      sessionId: 'private-session-id',
      status: 'running',
      workspaceName: 'flow',
      updatedAt: Date.now(),
      prompt: 'nao deve ser armazenado',
      transcript: 'nao deve ser armazenado'
    };
    assert.equal((await request(port, 'POST', '/api/agent-events', record, {
      Origin: 'http://outside.example:' + port
    })).status, 403);
    assert.equal((await request(port, 'POST', '/api/agent-events', record, {
      Host: 'outside.example:' + port
    })).status, 403);
    assert.equal((await request(port, 'POST', '/api/agent-events', record, {
      'Content-Type': 'text/plain'
    })).status, 415);

    const accepted = await request(port, 'POST', '/api/agent-events', record);
    assert.equal(accepted.status, 204);
    assert.equal((await request(port, 'POST', '/api/agent-events', {
      ...record,
      event: 'unknownEvent'
    })).status, 400);
    assert.equal((await request(port, 'POST', '/api/agent-events', {
      ...record,
      prompt: 'x'.repeat(9000)
    })).status, 413);

    const providers = JSON.parse((await request(port, 'GET', '/api/agents')).body);
    const copilot = providers.find(provider => provider.id === 'copilot');
    assert.equal(copilot.status, 'running');
    assert.equal(copilot.activeCount, 1);
    assert.equal(JSON.stringify(providers).includes('private-session-id'), false);
    assert.equal(JSON.stringify(providers).includes('nao deve ser armazenado'), false);
  } finally {
    await stopServer(child);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
