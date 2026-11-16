'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const { run, MAX_HOOK_INPUT_BYTES } = require('./agent-hook.cjs');

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('relay transmite somente o registro normalizado e devolve saida neutra ao hook', async () => {
  let received = '';
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      received = Buffer.concat(chunks).toString('utf8');
      response.writeHead(204);
      response.end();
    });
  });
  const port = await listen(server);
  const previousPort = process.env.CODEX_FLOW_PORT;
  process.env.CODEX_FLOW_PORT = String(port);
  const input = new PassThrough(), output = { text: '', write(value) { this.text += value; } };
  const errors = { text: '', write(value) { this.text += value; } };

  try {
    const completed = run(
      ['node', 'agent-hook.cjs', 'copilot', 'userPromptSubmitted'],
      input,
      output,
      errors
    );
    input.end(JSON.stringify({
      sessionId: 'session-local',
      cwd: 'C:\\Repos\\flow',
      prompt: 'conteudo privado',
      transcriptPath: 'C:\\private\\transcript.jsonl'
    }));
    await completed;

    const record = JSON.parse(received);
    assert.equal(record.provider, 'copilot');
    assert.equal(record.sessionId, 'session-local');
    assert.equal(record.workspaceName, 'flow');
    assert.equal(record.status, 'running');
    assert.equal(Object.prototype.hasOwnProperty.call(record, 'prompt'), false);
    assert.equal(JSON.stringify(record).includes('transcript'), false);
    assert.equal(output.text.trim(), '{}');
    assert.equal(errors.text, '');
  } finally {
    if (previousPort === undefined) delete process.env.CODEX_FLOW_PORT;
    else process.env.CODEX_FLOW_PORT = previousPort;
    await close(server);
  }
});

test('relay ignora stdin acima do limite sem conectar ao servidor', async () => {
  const input = new PassThrough(), output = { text: '', write(value) { this.text += value; } };
  const errors = { text: '', write(value) { this.text += value; } };
  const completed = run(
    ['node', 'agent-hook.cjs', 'copilot', 'userPromptSubmitted'],
    input,
    output,
    errors
  );
  input.end(Buffer.alloc(MAX_HOOK_INPUT_BYTES + 1, 97));
  await completed;

  assert.equal(output.text.trim(), '{}');
  assert.match(errors.text, /excedeu o limite/);
});
