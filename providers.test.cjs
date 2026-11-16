'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  listAllSessions,
  resolveSession,
  readProviderBatch,
  parseSessionKey
} = require('./providers/index.cjs');

test('parseSessionKey separa provedor e caminho relativo com segurança', () => {
  assert.deepEqual(parseSessionKey('antigravity:abc-123'), { provider: 'antigravity', rel: 'abc-123' });
  assert.deepEqual(parseSessionKey('2026/11/12/rollout-1.jsonl'), { provider: 'codex', rel: '2026/11/12/rollout-1.jsonl' });
  assert.equal(parseSessionKey(''), null);
});

test('descobre e normaliza sessões de Codex, Antigravity, Copilot CLI e Claude Code', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-providers-'));
  try {
    // 1. Codex
    const codexDir = path.join(tmp, 'codex', '2026', '11', '12');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'rollout-1.jsonl'), [
      JSON.stringify({ timestamp: '2026-11-12T10:00:00Z', type: 'session_meta', payload: { id: 'c1', cwd: 'X:\\repo' } }),
      JSON.stringify({ timestamp: '2026-11-12T10:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Oi Codex' }] } })
    ].join('\n') + '\n');

    // 2. Antigravity
    const agDir = path.join(tmp, 'antigravity', 'conv-ag-1', '.system_generated', 'logs');
    fs.mkdirSync(agDir, { recursive: true });
    fs.writeFileSync(path.join(agDir, 'transcript.jsonl'), [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-12T11:00:00Z', content: '<USER_REQUEST>\nOi Antigravity\n</USER_REQUEST>' }),
      JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-12T11:00:01Z', thinking: 'Analisando...', tool_calls: [{ name: 'read_file', args: { Path: 'a.txt' } }] }),
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: '2026-11-12T11:00:02Z', content: 'conteudo de a.txt' }),
      JSON.stringify({ step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-12T11:00:03Z', content: 'Pronto!' })
    ].join('\n') + '\n');

    // 3. Copilot CLI
    const copDir = path.join(tmp, 'copilot', 'cop-1');
    fs.mkdirSync(copDir, { recursive: true });
    fs.writeFileSync(path.join(copDir, 'events.jsonl'), [
      JSON.stringify({ type: 'session.start', timestamp: '2026-11-12T12:00:00Z', data: { sessionId: 'cop-1', selectedModel: 'gpt-5', context: { cwd: 'X:\\repo' } } }),
      JSON.stringify({ type: 'user.message', timestamp: '2026-11-12T12:00:01Z', data: { content: 'Oi Copilot' } }),
      JSON.stringify({ type: 'tool.execution_start', timestamp: '2026-11-12T12:00:02Z', data: { toolCallId: 'tc1', toolName: 'view', arguments: { path: 'x.md' } } }),
      JSON.stringify({ type: 'tool.execution_complete', timestamp: '2026-11-12T12:00:03Z', data: { toolCallId: 'tc1', success: true, result: { content: 'ok' } } }),
      JSON.stringify({ type: 'assistant.message', timestamp: '2026-11-12T12:00:04Z', data: { content: 'Feito!' } })
    ].join('\n') + '\n');

    // 4. Claude Code
    const claudeDir = path.join(tmp, 'claude', 'proj-a');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'sess-cl-1.jsonl'), [
      JSON.stringify({ type: 'user', timestamp: '2026-11-12T13:00:00Z', sessionId: 'sess-cl-1', cwd: 'X:\\repo', message: { role: 'user', content: 'Oi Claude' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-11-12T13:00:02Z', sessionId: 'sess-cl-1', message: { role: 'assistant', model: 'claude-sonnet', content: [{ type: 'thinking', thinking: 'Pensando...' }, { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'b.txt' } }] } }),
      JSON.stringify({ type: 'user', timestamp: '2026-11-12T13:00:03Z', sessionId: 'sess-cl-1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'linha 1' }] } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-11-12T13:00:04Z', sessionId: 'sess-cl-1', message: { role: 'assistant', content: [{ type: 'text', text: 'Concluído!' }] } })
    ].join('\n') + '\n');

    const roots = {
      codex: path.join(tmp, 'codex'),
      antigravity: path.join(tmp, 'antigravity'),
      copilot: path.join(tmp, 'copilot'),
      claude: path.join(tmp, 'claude')
    };

    const sessions = listAllSessions(roots);
    assert.equal(sessions.length, 4);
    assert.deepEqual(sessions.map(s => s.provider).sort(), ['antigravity', 'claude', 'codex', 'copilot']);

    const agSession = sessions.find(s => s.provider === 'antigravity');
    assert.equal(agSession.title, 'Oi Antigravity');
    const resolvedAg = resolveSession(agSession.f, roots);
    assert.ok(resolvedAg && resolvedAg.file.endsWith('transcript.jsonl'));

    const stateAg = { offset: 0, pending: Buffer.alloc(0) };
    const agRecords = readProviderBatch(resolvedAg, stateAg);
    assert.ok(agRecords.some(r => r.type === 'response_item' && r.payload.type === 'message' && r.payload.role === 'user'));
    assert.ok(agRecords.some(r => r.type === 'response_item' && r.payload.type === 'reasoning'));
    assert.ok(agRecords.some(r => r.type === 'response_item' && r.payload.type === 'function_call' && r.payload.name === 'read_file'));
    assert.ok(agRecords.some(r => r.type === 'response_item' && r.payload.type === 'function_call_output'));
    assert.ok(agRecords.some(r => r.type === 'response_item' && r.payload.type === 'message' && r.payload.role === 'assistant'));

    const copSession = sessions.find(s => s.provider === 'copilot');
    assert.equal(copSession.title, 'Oi Copilot');
    const copRecords = readProviderBatch(resolveSession(copSession.f, roots), { offset: 0, pending: Buffer.alloc(0) });
    assert.ok(copRecords.some(r => r.type === 'session_meta' && r.payload.model === 'gpt-5'));
    assert.ok(copRecords.some(r => r.type === 'response_item' && r.payload.type === 'function_call' && r.payload.name === 'view'));

    const clSession = sessions.find(s => s.provider === 'claude');
    assert.equal(clSession.title, 'Oi Claude');
    const clRecords = readProviderBatch(resolveSession(clSession.f, roots), { offset: 0, pending: Buffer.alloc(0) });
    assert.ok(clRecords.some(r => r.type === 'response_item' && r.payload.type === 'reasoning'));
    assert.ok(clRecords.some(r => r.type === 'response_item' && r.payload.type === 'function_call' && r.payload.name === 'Read'));
    assert.ok(clRecords.some(r => r.type === 'response_item' && r.payload.type === 'function_call_output' && r.payload.call_id === 'tu1'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
