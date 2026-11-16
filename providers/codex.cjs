'use strict';
const fs = require('node:fs');
const path = require('node:path');

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/^rollout-.*\.jsonl$/.test(entry.name)) {
      try {
        const st = fs.statSync(full);
        out.push({ full, m: st.mtimeMs, s: st.size });
      } catch {}
    }
  }
  return out;
}

const metaCache = new Map();
function sessionMeta(file) {
  if (metaCache.has(file)) return metaCache.get(file);
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(131072);
    let n;
    try { n = fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    const first = buf.subarray(0, n).toString('utf8').split('\n')[0];
    const meta = JSON.parse(first).payload || {};
    metaCache.set(file, meta);
    return meta;
  } catch {
    return {};
  }
}

function sessionNames(root) {
  const names = new Map();
  try {
    const idx = fs.readFileSync(path.join(path.dirname(root), 'session_index.jsonl'), 'utf8');
    for (const line of idx.split('\n')) {
      try {
        const s = JSON.parse(line);
        if (s.thread_name) names.set(s.id, s.thread_name);
      } catch {}
    }
  } catch {}
  return names;
}

const rowCache = new Map();
function listSessions(root) {
  if (!root || !fs.existsSync(root)) return [];
  const names = sessionNames(root);
  const rows = [];
  for (const item of walk(root, [])) {
    const meta = sessionMeta(item.full);
    if (meta.parent_thread_id || (meta.source && meta.source.subagent)) continue;
    const rel = path.relative(root, item.full).split(path.sep).join('/');
    const cached = rowCache.get(item.full);
    let first = '';
    let activity = item.m;
    if (cached && cached.m === item.m && cached.s === item.s) {
      first = cached.first;
      activity = cached.activity;
    } else {
      try {
        const fd = fs.openSync(item.full, 'r');
        const read = (pos, len) => {
          const b = Buffer.alloc(len);
          return b.subarray(0, fs.readSync(fd, b, 0, len, pos)).toString('utf8');
        };
        let chunks;
        try {
          chunks = [
            read(0, Math.min(item.s, 524288)),
            read(Math.max(0, item.s - 262144), Math.min(item.s, 262144))
          ];
        } finally { fs.closeSync(fd); }
        for (const chunk of chunks) {
          for (const line of chunk.split('\n')) {
            try {
              const o = JSON.parse(line), p = o.payload || {};
              const ts = Date.parse(o.timestamp);
              if (Number.isFinite(ts)) activity = Math.max(activity, ts);
              if (o.type !== 'response_item' || p.type !== 'message' || p.role !== 'user') continue;
              const text = (p.content || [])
                .map(c => c.text || '')
                .filter(t => t.trim() && !/^\s*(<|# AGENTS\.md)/.test(t))
                .join(' ').replace(/\s+/g, ' ').trim();
              if (text && !first) first = text;
            } catch {}
          }
        }
      } catch {}
      rowCache.set(item.full, { m: item.m, s: item.s, first, activity });
    }
    rows.push({
      provider: 'codex',
      f: rel,
      m: activity,
      sourceM: item.m,
      s: item.s,
      id: meta.id || rel,
      title: names.get(meta.id) || first.slice(0, 90) || 'Conversa sem título',
      summary: first.slice(0, 220),
      cwd: meta.cwd || ''
    });
  }
  return rows;
}

function resolveFile(root, rel) {
  if (!root || !rel) return null;
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

function normalizeRecord(record) {
  return [record];
}

module.exports = { id: 'codex', label: 'Codex', listSessions, resolveFile, normalizeRecord, sessionMeta };
