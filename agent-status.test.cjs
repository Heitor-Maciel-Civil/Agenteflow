'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentStatusStore, normalizeProviderEvent } = require('./agent-status.cjs');

test('Antigravity Stop distingue inatividade completa de trabalho em segundo plano', () => {
  const idle = normalizeProviderEvent('antigravity', 'Stop', {
    conversationId: 'conversation-1',
    workspacePaths: ['C:\\Projetos\\Projeto A'],
    fullyIdle: true,
    lastUserInput: 'nao deve sair do processo',
    transcriptPath: 'C:\\private\\transcript.jsonl'
  }, 10000);
  const background = normalizeProviderEvent('antigravity', 'Stop', {
    conversationId: 'conversation-1',
    fullyIdle: false
  }, 11000);

  assert.equal(idle.status, 'idle');
  assert.equal(idle.workspaceName, 'Projeto A');
  assert.equal(background.status, 'running');
  assert.equal(JSON.stringify(idle).includes('nao deve sair'), false);
  assert.equal(JSON.stringify(idle).includes('transcript'), false);
  const store = new AgentStatusStore();
  assert.equal(store.apply(idle), true);
  assert.equal(store.snapshot(10000).find(provider => provider.id === 'antigravity').status, 'idle');
});

test('Copilot aceita os dois formatos e separa subagentes sem copiar prompts', () => {
  const root = normalizeProviderEvent('copilot', 'userPromptSubmitted', {
    sessionId: 'session-1',
    cwd: 'D:\\Repos\\flow',
    prompt: 'texto privado'
  }, 20000);
  const child = normalizeProviderEvent('copilot', 'userPromptSubmitted', {
    sessionId: 'session-1',
    agentId: 'agent-2',
    agentType: 'review',
    cwd: 'D:\\Repos\\flow',
    prompt: 'outro texto privado'
  }, 21000);
  const stopped = normalizeProviderEvent('copilot', 'Stop', {
    session_id: 'session-1',
    cwd: 'D:\\Repos\\flow',
    stop_hook_active: false
  }, 22000);

  assert.equal(root.status, 'running');
  assert.equal(root.agentId, undefined);
  assert.equal(child.status, 'running');
  assert.equal(child.agentId, 'agent-2');
  assert.equal(child.agentType, 'review');
  assert.equal(stopped.status, 'idle');
  assert.equal(JSON.stringify([root, child, stopped]).includes('texto privado'), false);
});

test('Claude Code identifica subagentes e o encerramento da sessao', () => {
  const child = normalizeProviderEvent('claude', 'SubagentStart', {
    session_id: 'claude-1',
    agent_id: 'child-1',
    agent_type: 'Explore',
    cwd: 'C:\\work\\repo',
    prompt: 'nao copiar'
  }, 30000);
  const ended = normalizeProviderEvent('claude', 'SessionEnd', {
    session_id: 'claude-1',
    cwd: 'C:\\work\\repo',
    reason: 'complete'
  }, 31000);

  assert.equal(child.status, 'running');
  assert.equal(child.agentId, 'child-1');
  assert.equal(child.agentType, 'Explore');
  assert.equal(ended.status, 'ended');
});

test('eventos desconhecidos, IDs ausentes e Antigravity Stop sem fullyIdle sao rejeitados', () => {
  assert.equal(normalizeProviderEvent('unknown', 'Stop', { sessionId: 'x' }, 1), null);
  assert.equal(normalizeProviderEvent('copilot', 'unknownEvent', { sessionId: 'x' }, 1), null);
  assert.equal(normalizeProviderEvent('copilot', 'agentStop', {}, 1), null);
  assert.equal(normalizeProviderEvent('antigravity', 'Stop', { conversationId: 'x' }, 1), null);
  assert.equal(normalizeProviderEvent('claude', 'Stop', { session_id: 'x' }, NaN), null);
});

test('snapshot agrega sessoes sem revelar IDs e conserva identidades distintas', () => {
  const store = new AgentStatusStore();
  const root = normalizeProviderEvent('copilot', 'userPromptSubmitted', {
    sessionId: 'session-secret-1',
    cwd: 'C:\\Repos\\flow'
  }, 40000);
  const child = normalizeProviderEvent('copilot', 'userPromptSubmitted', {
    sessionId: 'session-secret-1',
    agentId: 'agent-secret-2',
    agentType: 'coding',
    cwd: 'C:\\Repos\\flow'
  }, 41000);
  const otherSession = normalizeProviderEvent('copilot', 'userPromptSubmitted', {
    sessionId: 'session-secret-3',
    cwd: 'C:\\Repos\\other'
  }, 42000);

  assert.equal(store.apply(root), true);
  assert.equal(store.apply(child), true);
  assert.equal(store.apply(otherSession), true);

  const copilot = store.snapshot(43000).find(provider => provider.id === 'copilot');
  assert.equal(copilot.status, 'running');
  assert.equal(copilot.activeCount, 3);
  assert.equal(copilot.sessions.length, 3);
  assert(copilot.sessions.every(session => session.workspaceName));
  assert.equal(JSON.stringify(copilot).includes('session-secret'), false);
  assert.equal(JSON.stringify(copilot).includes('agent-secret'), false);
});

test('sinais nao terminais envelhecem para unknown; ended expira apos um minuto', () => {
  const store = new AgentStatusStore();
  store.apply(normalizeProviderEvent('claude', 'UserPromptSubmit', {
    session_id: 'stale-session'
  }, 1000));
  store.apply(normalizeProviderEvent('claude', 'SessionEnd', {
    session_id: 'ended-session'
  }, 2000));

  const recent = store.snapshot(61000).find(provider => provider.id === 'claude');
  assert.equal(recent.sessions.some(session => session.status === 'ended'), true);
  const expired = store.snapshot(62001).find(provider => provider.id === 'claude');
  assert.equal(expired.sessions.some(session => session.status === 'ended'), false);

  const stale = store.snapshot(301001).find(provider => provider.id === 'claude');
  assert.equal(stale.status, 'unknown');
  assert.equal(stale.sessions.length, 1);
  assert.equal(stale.sessions[0].status, 'unknown');
});
