const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildPlanApprovedPrompt, buildPlanFeedbackPrompt } = require('./dispatch-bus.cjs');

const VALID_DECISIONS = new Set(['approved', 'changes_requested', 'rejected']);
const REV_RE = /^[a-f0-9-]{8,64}$/i;

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isConfined(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function createActionStore(options = {}) {
  const decisionsDir = options.decisionsDir || path.join(__dirname, 'data', 'decisions');
  const readyDir = options.readyDir || path.resolve(__dirname, '..', 'Integracoes', 'PlanCanvas', 'ready');
  const workspaceRoot = options.workspaceRoot || path.resolve(__dirname, '..', '..');
  const dispatchBus = options.dispatchBus || null;
  const decisionWaiters = new Map();

  function ensureDir() {
    fs.mkdirSync(decisionsDir, { recursive: true });
  }

  function decisionPath(revision) {
    if (!REV_RE.test(String(revision || ''))) throw new Error('Invalid revision');
    return path.join(decisionsDir, `${revision}.json`);
  }

  function getDecision(revision) {
    try {
      const p = decisionPath(revision);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  function recordDecision(input = {}) {
    ensureDir();
    const revision = String(input.revision || '').trim();
    const decision = String(input.decision || '').trim().toLowerCase();
    if (!REV_RE.test(revision)) throw new Error('Invalid revision');
    if (!VALID_DECISIONS.has(decision)) throw new Error('Invalid decision');

    const matchedPlan = scanReadyPlans().find(p => p.revision === revision) || null;
    const resolvedThread = String(input.thread || (matchedPlan && matchedPlan.thread) || '').trim();
    const resolvedProvider = resolvedThread && /^[a-f0-9-]{36}$/i.test(resolvedThread) && !String(input.sessionId || '').startsWith('antigravity:')
      ? 'codex'
      : String(input.provider || 'antigravity').toLowerCase();
    const resolvedSessionId = resolvedThread || String(input.sessionId || '');

    const record = {
      id: crypto.randomUUID(),
      revision,
      decision,
      file: String(input.file || (matchedPlan && matchedPlan.file) || ''),
      sha256: String(input.sha256 || (matchedPlan && matchedPlan.sha256) || ''),
      comments: Array.isArray(input.comments) ? input.comments : [],
      provider: resolvedProvider,
      sessionId: resolvedSessionId,
      thread: resolvedThread,
      recordedAt: Date.now()
    };

    const p = decisionPath(revision);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
    fs.renameSync(tmp, p);

    const waiters = decisionWaiters.get(revision);
    if (waiters) {
      for (const w of Array.from(waiters)) {
        clearTimeout(w.timer);
        w.resolve(record);
      }
      decisionWaiters.delete(revision);
    }

    let dispatch = null;
    if (dispatchBus && (decision === 'approved' || decision === 'changes_requested')) {
      const prompt = decision === 'approved'
        ? buildPlanApprovedPrompt(record)
        : buildPlanFeedbackPrompt(record);
      dispatch = dispatchBus.enqueue({
        type: decision === 'approved' ? 'plan_approved' : 'plan_feedback',
        provider: record.provider,
        sessionId: record.sessionId,
        prompt,
        payload: {
          revision: record.revision,
          file: record.file,
          sha256: record.sha256,
          decision: record.decision,
          comments: record.comments,
          thread: record.thread
        }
      });
    }

    return { record, dispatch };
  }

  function waitForDecision(revision, timeoutMs = 30000) {
    const existing = getDecision(revision);
    if (existing) return Promise.resolve(existing);
    return new Promise(resolve => {
      const set = decisionWaiters.get(revision) || new Set();
      const entry = {
        resolve,
        timer: setTimeout(() => {
          set.delete(entry);
          if (!set.size) decisionWaiters.delete(revision);
          resolve(null);
        }, Math.max(200, Number(timeoutMs) || 30000))
      };
      set.add(entry);
      decisionWaiters.set(revision, set);
    });
  }

  function scanReadyPlans() {
    const plans = [];
    if (!fs.existsSync(readyDir)) return plans;
    let entries = [];
    try { entries = fs.readdirSync(readyDir); } catch { return plans; }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const sigPath = path.join(readyDir, name);
      try {
        const sig = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
        const rev = String(sig.revision || '');
        if (!REV_RE.test(rev) || !sig.file) continue;
        const absFile = path.isAbsolute(sig.file) ? sig.file : path.resolve(workspaceRoot, sig.file);
        if (!isConfined(workspaceRoot, absFile) || !fs.existsSync(absFile)) continue;
        const actualHash = sha256File(absFile);
        if (sig.sha256 && sig.sha256 !== actualHash) continue;
        const decision = getDecision(rev);
        const content = fs.readFileSync(absFile, 'utf8');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const rawPub = sig.readyAt || sig.publishedAt || sig.timestamp;
        const pubMs = typeof rawPub === 'number' ? rawPub : (Date.parse(rawPub || '') || fs.statSync(sigPath).mtimeMs);
        plans.push({
          revision: rev,
          title: titleMatch ? titleMatch[1].trim() : path.basename(absFile),
          file: path.relative(workspaceRoot, absFile).replace(/\\/g, '/'),
          sha256: actualHash,
          publishedAt: pubMs,
          thread: sig.thread || '',
          decision: decision ? decision.decision : null,
          decidedAt: decision ? decision.recordedAt : null,
          hasChanges: !!(decision && (decision.decision === 'changes_requested' || (Array.isArray(decision.comments) && decision.comments.length > 0)))
        });
      } catch {}
    }
    plans.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    return plans;
  }

  function readPlanContent(revision) {
    const plans = scanReadyPlans();
    const match = plans.find(p => p.revision === revision);
    if (!match) return null;
    const absFile = path.resolve(workspaceRoot, match.file);
    if (!isConfined(workspaceRoot, absFile) || !fs.existsSync(absFile)) return null;
    return {
      ...match,
      content: fs.readFileSync(absFile, 'utf8')
    };
  }

  return {
    decisionsDir,
    readyDir,
    getDecision,
    recordDecision,
    waitForDecision,
    scanReadyPlans,
    readPlanContent
  };
}

module.exports = { createActionStore };
