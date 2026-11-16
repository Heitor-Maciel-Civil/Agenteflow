'use strict';

const http = require('node:http');
const { normalizeProviderEvent } = require('./agent-status.cjs');

const MAX_HOOK_INPUT_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 1500;

function readInput(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, tooLarge = false;
    stream.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_HOOK_INPUT_BYTES) { tooLarge = true; chunks.length = 0; return; }
      if (!tooLarge) chunks.push(chunk);
    });
    stream.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function relay(record, port) {
  const body = Buffer.from(JSON.stringify(record));
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/agent-events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length
      }
    }, response => {
      response.resume();
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve();
        reject(new Error('Servidor recusou o evento (' + response.statusCode + ').'));
      });
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Tempo limite do relay local.')));
    request.on('error', reject);
    request.end(body);
  });
}

async function run(args, stdin, stdout, stderr) {
  const provider = args[2], eventName = args[3];
  try {
    const text = await readInput(stdin);
    if (text === null) {
      stderr.write('Codex Flow: payload do hook excedeu o limite; evento ignorado.\n');
    } else {
      let input;
      try { input = JSON.parse(text); }
      catch { input = null; }
      const record = normalizeProviderEvent(provider, eventName, input);
      if (!record) {
        stderr.write('Codex Flow: evento de hook invalido ou nao suportado; evento ignorado.\n');
      } else {
        const configuredPort = Number(process.env.CODEX_FLOW_PORT || 4455);
        if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
          throw new Error('CODEX_FLOW_PORT precisa ser uma porta local valida.');
        }
        await relay(record, configuredPort);
      }
    }
  } catch (error) {
    stderr.write('Codex Flow: relay local indisponivel; ' + error.message + '\n');
  }
  stdout.write('{}\n');
}

if (require.main === module) {
  run(process.argv, process.stdin, process.stdout, process.stderr);
}

module.exports = { readInput, relay, run, MAX_HOOK_INPUT_BYTES, REQUEST_TIMEOUT_MS };
