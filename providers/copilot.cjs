'use strict';
const fs = require('node:fs');
const path = require('node:path');

function listSessions(root) {
  if (!root || !fs.existsSync(root)) return [];
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const rows = [];
  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const file = path.join(root, d.name, 'events.jsonl');
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    let first = '';
    let cwd = '';
    let activity = st.mtimeMs;
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(Math.min(st.size, 262144));
      let n = 0;
      try { n = fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
      for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          const ts = Date.parse(o.timestamp);
          if (Number.isFinite(ts)) activity = Math.max(activity, ts);
          if (o.type === 'session.start' && o.data?.context?.cwd) cwd = o.data.context.cwd;
          if (o.type === 'user.message' && !first && o.data?.content) {
            first = String(o.data.content).replace(/\s+/g, ' ').trim();
          }
        } catch {}
      }
    } catch {}
    rows.push({
      provider: 'copilot',
      f: 'copilot:' + d.name,
      m: activity,
      sourceM: st.mtimeMs,
      s: st.size,
      id: d.name,
      title: first.slice(0, 90) || 'Copilot ' + d.name.slice(0, 8),
      summary: first.slice(0, 220),
      cwd
    });
  }
  return rows;
}

function resolveFile(root, rel) {
  if (!root || !rel || /[\\/:]/.test(rel) || rel.includes('..')) return null;
  const full = path.resolve(root, rel, 'events.jsonl');
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return [];
  const ts = record.timestamp || new Date().toISOString();
  const d = record.data || {};
  switch (record.type) {
    case 'session.start':
      return [{
        timestamp: ts,
        type: 'session_meta',
        payload: { id: d.sessionId || '', cwd: d.context?.cwd || '', model: d.selectedModel || '' }
      }];
    case 'user.message':
      return d.content ? [{
        timestamp: ts,
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: String(d.content) }] }
      }] : [];
    case 'assistant.message': {
      const out = [];
      if (d.reasoningText) {
        out.push({ timestamp: ts, type: 'response_item', payload: { type: 'reasoning', summary: [{ text: String(d.reasoningText) }] } });
      }
      if (d.content) {
        out.push({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: String(d.content) }] } });
      }
      return out;
    }
    case 'tool.execution_start':
      return [{
        timestamp: ts,
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: d.toolName || 'tool',
          arguments: typeof d.arguments === 'string' ? d.arguments : JSON.stringify(d.arguments || {}),
          call_id: d.toolCallId || ''
        }
      }];
    case 'tool.execution_complete':
      return [{
        timestamp: ts,
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: d.toolCallId || '',
          output: String(d.result?.content || d.error?.message || (d.success ? 'OK' : 'error'))
        }
      }];
    case 'assistant.turn_end':
      return [{ timestamp: ts, type: 'event_msg', payload: { type: 'task_complete' } }];
    default:
      return [];
  }
}

module.exports = { id: 'copilot', label: 'Copilot CLI', listSessions, resolveFile, normalizeRecord };
