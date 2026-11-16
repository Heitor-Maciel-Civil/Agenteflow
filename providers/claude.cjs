'use strict';
const fs = require('node:fs');
const path = require('node:path');

function walkJsonl(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(full, out);
    else if (/\.jsonl$/i.test(e.name)) {
      try {
        const st = fs.statSync(full);
        out.push({ full, m: st.mtimeMs, s: st.size });
      } catch {}
    }
  }
  return out;
}

function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join(' ').trim();
}

function listSessions(root) {
  if (!root || !fs.existsSync(root)) return [];
  const rows = [];
  for (const item of walkJsonl(root, [])) {
    const rel = path.relative(root, item.full).split(path.sep).join('/');
    let first = '';
    let cwd = '';
    let activity = item.m;
    try {
      const fd = fs.openSync(item.full, 'r');
      const buf = Buffer.alloc(Math.min(item.s, 262144));
      let n = 0;
      try { n = fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
      for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          const ts = Date.parse(o.timestamp);
          if (Number.isFinite(ts)) activity = Math.max(activity, ts);
          if (!cwd && o.cwd) cwd = o.cwd;
          if (!first && o.type === 'user' && o.message) {
            first = extractText(o.message.content).replace(/\s+/g, ' ').trim();
          }
        } catch {}
      }
    } catch {}
    rows.push({
      provider: 'claude',
      f: 'claude:' + rel,
      m: activity,
      sourceM: item.m,
      s: item.s,
      id: path.basename(rel, '.jsonl'),
      title: first.slice(0, 90) || 'Claude ' + path.basename(rel, '.jsonl').slice(0, 8),
      summary: first.slice(0, 220),
      cwd
    });
  }
  return rows;
}

function resolveFile(root, rel) {
  if (!root || !rel || rel.includes('..')) return null;
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

function normalizeRecord(record, state) {
  if (!record || typeof record !== 'object') return [];
  const ts = record.timestamp || new Date().toISOString();
  const msg = record.message || {};
  const out = [];
  if (!state) state = {};

  if (record.cwd || msg.model) {
    out.push({
      timestamp: ts,
      type: 'session_meta',
      payload: { id: record.sessionId || '', cwd: record.cwd || '', model: msg.model || '' }
    });
  }

  const content = msg.content;
  if (record.type === 'user') {
    const hasPromptText = (typeof content === 'string' && content.trim()) ||
      (Array.isArray(content) && content.some(b => b?.type === 'text' && b.text));
    if (hasPromptText) {
      if (state._clInTurn) out.push({ timestamp: ts, type: 'event_msg', payload: { type: 'task_complete' } });
      state._clInTurn = true;
    }
    if (typeof content === 'string' && content.trim()) {
      out.push({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] } });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'text' && block.text) {
          out.push({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: block.text }] } });
        } else if (block?.type === 'tool_result') {
          const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '');
          out.push({ timestamp: ts, type: 'response_item', payload: { type: 'function_call_output', call_id: block.tool_use_id || '', output: text } });
        }
      }
    }
  } else if (record.type === 'assistant') {
    if (typeof content === 'string' && content.trim()) {
      out.push({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] } });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'thinking' && block.thinking) {
          out.push({ timestamp: ts, type: 'response_item', payload: { type: 'reasoning', summary: [{ text: block.thinking }] } });
        } else if (block?.type === 'tool_use') {
          out.push({ timestamp: ts, type: 'response_item', payload: { type: 'function_call', name: block.name || 'tool', arguments: JSON.stringify(block.input || {}), call_id: block.id || '' } });
        } else if (block?.type === 'text' && block.text) {
          out.push({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: block.text }] } });
        }
      }
    }
  }
  return out;
}

module.exports = { id: 'claude', label: 'Claude Code', listSessions, resolveFile, normalizeRecord };
