const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const UUID_RE = /^[a-f0-9-]{36}$/i;

function buildSpecialistPrompt(spec) {
  const parts = [
    `[Agent Flow — Especialista vinculado: ${spec.id}]`,
    `Leia integralmente a skill em "${spec.skillPath || ('.agents/skills/' + spec.id + '/SKILL.md')}" e sua memoria em "${spec.memoryPath || ('.agents/skills/' + spec.id + '/memoria.md')}".`
  ];
  if (spec.note) {
    parts.push(`Resumo / diretriz informada pelo usuario: ${spec.note}`);
  }
  parts.push('Analise o contexto atual desta sessao com base no seu conhecimento de especialista e no resumo acima, identifique onde voce pode atuar e inicie sua contribuicao.');
  return parts.join(' ');
}

function buildPlanApprovedPrompt(info) {
  const parts = [
    `[Agent Flow — Plano APROVADO pelo usuario]`,
    `Revisao: ${info.revision}.`,
    info.file ? `Arquivo: ${info.file}.` : '',
    'Aprovacao explicita confirmada no Agent Flow. Inicie imediatamente a execucao/resolucao deste plano seguindo as etapas aprovadas.'
  ];
  if (Array.isArray(info.comments) && info.comments.length) {
    parts.push(`Observacoes adicionais (${info.comments.length}): ${info.comments.map(c => c.text || c).join(' | ')}`);
  }
  return parts.filter(Boolean).join(' ');
}

function buildPlanFeedbackPrompt(info) {
  const comments = Array.isArray(info.comments) ? info.comments.map(c => c.text || c).join(' | ') : '';
  return [
    `[Agent Flow — Ajuste solicitado no plano]`,
    `Revisao: ${info.revision}.`,
    info.file ? `Arquivo: ${info.file}.` : '',
    comments ? `Comentarios do usuario: ${comments}` : 'O usuario solicitou revisao antes da execucao.'
  ].filter(Boolean).join(' ');
}

function extractUuid(value) {
  const m = String(value || '').match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  return m ? m[0].toLowerCase() : '';
}

function createDispatchBus(options = {}) {
  const inboxDir = options.inboxDir || path.join(__dirname, 'data', 'inbox');
  const workspaceRoot = options.workspaceRoot || path.resolve(__dirname, '..', '..');
  const planCanvasInboxDir = options.planCanvasInboxDir !== undefined
    ? options.planCanvasInboxDir
    : path.join(workspaceRoot, 'Aplicativos', 'Integracoes', 'PlanCanvas', 'inbox');
  const cliRunner = options.cliRunner || null;
  const enableCliDispatch = options.enableCliDispatch === true;
  const activeLocks = new Set();
  const waiters = new Set();

  function ensureDir() {
    fs.mkdirSync(inboxDir, { recursive: true });
  }

  function itemPath(id) {
    if (!UUID_RE.test(String(id || ''))) throw new Error('Invalid dispatch id');
    return path.join(inboxDir, `${id}.json`);
  }

  function queuedPath(id) {
    if (!UUID_RE.test(String(id || ''))) throw new Error('Invalid dispatch id');
    return path.join(inboxDir, `${id}.queued`);
  }

  function matchesFilter(item, filter = {}) {
    if (filter.provider && item.provider && item.provider !== filter.provider) return false;
    if (filter.sessionId && item.sessionId && item.sessionId !== filter.sessionId) return false;
    return true;
  }

  function listPending(filter = {}) {
    ensureDir();
    const out = [];
    let files = [];
    try { files = fs.readdirSync(inboxDir); } catch { return out; }
    for (const name of files) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (!UUID_RE.test(id)) continue;
      if (fs.existsSync(path.join(inboxDir, `${id}.queued`))) continue;
      try {
        const item = JSON.parse(fs.readFileSync(path.join(inboxDir, name), 'utf8'));
        if (matchesFilter(item, filter)) out.push(item);
      } catch {}
    }
    out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return out;
  }

  function ack(id, meta = {}) {
    ensureDir();
    const p = itemPath(id);
    if (!fs.existsSync(p)) return false;
    const qp = queuedPath(id);
    fs.writeFileSync(qp, JSON.stringify({ id, queuedAt: Date.now(), ...meta }, null, 2));
    return true;
  }

  function notifyWaiters(item) {
    for (const w of Array.from(waiters)) {
      if (matchesFilter(item, w.filter)) {
        waiters.delete(w);
        clearTimeout(w.timer);
        w.resolve([item]);
      }
    }
  }

  function defaultCliRunner(item) {
    const provider = String(item.provider || '').toLowerCase();
    const convId = String(item.sessionId || '').replace(/^antigravity:/i, '').trim();
    if (!convId || !item.prompt) return Promise.resolve({ dispatched: false, reason: 'missing_target' });

    let cmd = null;
    let args = [];
    if (provider === 'antigravity') {
      cmd = process.env.AGY_BIN || 'agy';
      args = ['-p', item.prompt, '--conversation', convId, '--output-format', 'json'];
    } else if (provider === 'claude') {
      cmd = process.env.CLAUDE_BIN || 'claude';
      args = ['-p', item.prompt, '--resume', convId, '--output-format', 'json'];
    } else {
      return Promise.resolve({ dispatched: false, reason: 'bridge_only_provider' });
    }

    return new Promise(resolve => {
      try {
        const child = spawn(cmd, args, {
          cwd: workspaceRoot,
          stdio: 'ignore',
          detached: false,
          windowsHide: true
        });
        child.once('error', err => resolve({ dispatched: false, reason: err.code || err.message }));
        child.once('spawn', () => {
          resolve({ dispatched: true, pid: child.pid, transport: cmd });
        });
      } catch (err) {
        resolve({ dispatched: false, reason: err.message });
      }
    });
  }

  async function tryCliDispatch(item) {
    if (!enableCliDispatch && !cliRunner) return { dispatched: false, reason: 'cli_dispatch_disabled' };
    const lockKey = `${item.provider || 'unknown'}:${item.sessionId || 'global'}`;
    if (activeLocks.has(lockKey)) return { dispatched: false, reason: 'session_locked' };
    activeLocks.add(lockKey);
    try {
      const runner = cliRunner || defaultCliRunner;
      const result = await runner(item);
      if (result && result.dispatched) {
        ack(item.id, { transport: result.transport || 'cli', pid: result.pid || null });
      }
      return result || { dispatched: false };
    } finally {
      activeLocks.delete(lockKey);
    }
  }

  function enqueue(input = {}) {
    ensureDir();
    const id = crypto.randomUUID();
    const item = {
      id,
      type: String(input.type || 'action'),
      provider: String(input.provider || 'antigravity').toLowerCase(),
      sessionId: String(input.sessionId || ''),
      prompt: String(input.prompt || ''),
      payload: input.payload || {},
      createdAt: Date.now()
    };
    const tmp = path.join(inboxDir, `${id}.tmp`);
    const dest = itemPath(id);
    fs.writeFileSync(tmp, JSON.stringify(item, null, 2));
    fs.renameSync(tmp, dest);

    // Espelha para PlanCanvas/inbox/<uuid>.json quando o destino for thread Codex valida,
    // permitindo entrega instantanea pelo receive-feedback.js + bridge-runtime.mjs ja ativos no Codex.
    const codexThread = item.provider === 'codex'
      ? extractUuid((item.payload && item.payload.thread) || item.sessionId)
      : '';
    if (codexThread && planCanvasInboxDir) {
      try {
        fs.mkdirSync(planCanvasInboxDir, { recursive: true });
        const bridgeBatch = {
          id,
          thread: codexThread,
          artifact: (item.payload && item.payload.file) || '',
          receivedAt: new Date(item.createdAt).toISOString(),
          status: 'feedback',
          source: 'agent-flow',
          type: item.type,
          decision: (item.payload && item.payload.decision) || null,
          revision: (item.payload && item.payload.revision) || null,
          prompt: item.prompt,
          comments: (item.payload && item.payload.comments) || []
        };
        const bTmp = path.join(planCanvasInboxDir, `${id}.tmp`);
        const bDest = path.join(planCanvasInboxDir, `${id}.json`);
        fs.writeFileSync(bTmp, JSON.stringify(bridgeBatch, null, 2));
        fs.renameSync(bTmp, bDest);
      } catch {}
    }

    notifyWaiters(item);

    let dispatchPromise = Promise.resolve({ dispatched: false, reason: 'queued_only' });
    if (input.autoDispatch !== false) {
      dispatchPromise = tryCliDispatch(item).catch(err => ({ dispatched: false, reason: err.message }));
    }
    return { item, dispatchPromise };
  }

  function poll(filter = {}, timeoutMs = 20000) {
    const existing = listPending(filter);
    if (existing.length) return Promise.resolve(existing);
    return new Promise(resolve => {
      const waiter = {
        filter,
        resolve,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          resolve([]);
        }, Math.max(200, Number(timeoutMs) || 20000))
      };
      waiters.add(waiter);
    });
  }

  return {
    inboxDir,
    enqueue,
    listPending,
    ack,
    poll,
    activeLocks
  };
}

module.exports = {
  createDispatchBus,
  buildSpecialistPrompt,
  buildPlanApprovedPrompt,
  buildPlanFeedbackPrompt
};
