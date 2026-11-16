'use strict';
const os = require('node:os');
const path = require('node:path');
const { readBatch } = require('../flow-records.cjs');

const codex = require('./codex.cjs');
const antigravity = require('./antigravity.cjs');
const copilot = require('./copilot.cjs');
const claude = require('./claude.cjs');

const ADAPTERS = { codex, antigravity, copilot, claude };

function defaultRoots() {
  const home = os.homedir();
  return {
    codex: path.resolve(path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions')),
    antigravity: path.resolve(path.join(process.env.ANTIGRAVITY_BRAIN || path.join(home, '.gemini', 'antigravity', 'brain'))),
    copilot: path.resolve(path.join(process.env.COPILOT_SESSIONS || path.join(home, '.copilot', 'session-state'))),
    claude: path.resolve(path.join(process.env.CLAUDE_PROJECTS || path.join(home, '.claude', 'projects')))
  };
}

function parseSessionKey(key) {
  if (typeof key !== 'string' || !key.trim()) return null;
  const idx = key.indexOf(':');
  if (idx > 0) {
    const provider = key.slice(0, idx);
    const rel = key.slice(idx + 1);
    if (Object.prototype.hasOwnProperty.call(ADAPTERS, provider) && rel) {
      return { provider, rel };
    }
  }
  return { provider: 'codex', rel: key };
}

function listAllSessions(roots = defaultRoots()) {
  const all = [];
  for (const [id, adapter] of Object.entries(ADAPTERS)) {
    const r = roots[id];
    if (!r) continue;
    all.push(...adapter.listSessions(r));
  }
  return all.sort((a, b) => b.m - a.m);
}

function resolveSession(key, roots = defaultRoots()) {
  const parsed = parseSessionKey(key);
  if (!parsed) return null;
  const adapter = ADAPTERS[parsed.provider];
  const root = roots[parsed.provider];
  if (!adapter || !root) return null;
  const file = adapter.resolveFile(root, parsed.rel);
  if (!file) return null;
  return { provider: parsed.provider, key, rel: parsed.rel, root, file, adapter };
}

function readProviderBatch(resolved, state) {
  const rawRecords = readBatch(resolved.file, state);
  const out = [];
  for (const rec of rawRecords) {
    out.push(...resolved.adapter.normalizeRecord(rec, state));
  }
  return out;
}

module.exports = {
  ADAPTERS,
  defaultRoots,
  parseSessionKey,
  listAllSessions,
  resolveSession,
  readProviderBatch
};
