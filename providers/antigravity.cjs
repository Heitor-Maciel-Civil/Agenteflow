'use strict';
const fs = require('node:fs');
const path = require('node:path');

function cleanUserText(raw) {
  if (typeof raw !== 'string') return '';
  const match = raw.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  const text = match ? match[1] : raw;
  return text.replace(/<ADDITIONAL_METADATA>[\s\S]*$/i, '').replace(/\s+/g, ' ').trim();
}

const agRowCache = new Map();
function listSessions(root) {
  if (!root || !fs.existsSync(root)) return [];
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const rows = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const file = path.join(root, d.name, '.system_generated', 'logs', 'transcript.jsonl');
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const cached = agRowCache.get(file);
    let first = '';
    let activity = st.mtimeMs;
    if (cached && cached.m === st.mtimeMs && cached.s === st.size) {
      first = cached.first;
      activity = cached.activity;
    } else {
      try {
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(Math.min(st.size, 262144));
        let n = 0;
        try { n = fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
        for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            const o = JSON.parse(line);
            const ts = Date.parse(o.created_at);
            if (Number.isFinite(ts)) activity = Math.max(activity, ts);
            if (o.type === 'USER_INPUT' && !first) {
              first = cleanUserText(o.content || '');
            }
          } catch {}
        }
      } catch {}
      agRowCache.set(file, { m: st.mtimeMs, s: st.size, first, activity });
    }
    rows.push({
      provider: 'antigravity',
      f: 'antigravity:' + d.name,
      m: activity,
      sourceM: st.mtimeMs,
      s: st.size,
      id: d.name,
      title: first.slice(0, 90) || 'Antigravity ' + d.name.slice(0, 8),
      summary: first.slice(0, 220),
      cwd: ''
    });
  }
  return rows;
}

function resolveFile(root, rel) {
  if (!root || !rel || /[\\/:]/.test(rel) || rel.includes('..')) return null;
  const full = path.resolve(root, rel, '.system_generated', 'logs', 'transcript.jsonl');
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

function normalizeRecord(record, state) {
  if (!record || typeof record !== 'object') return [];
  const ts = record.created_at || new Date().toISOString();
  const out = [];
  if (!state._agPendingCalls) state._agPendingCalls = [];

  if (record.type === 'USER_INPUT') {
    const text = cleanUserText(record.content || '');
    if (text) {
      if (state._agInTurn) {
        out.push({ timestamp: ts, type: 'event_msg', payload: { type: 'task_complete' } });
      }
      state._agInTurn = true;
      out.push({
        timestamp: ts,
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
      });
      out.push({ timestamp: ts, type: 'event_msg', payload: { type: 'task_started' } });
    }
    return out;
  }

  if (record.type === 'PLANNER_RESPONSE') {
    if (record.thinking && String(record.thinking).trim()) {
      out.push({
        timestamp: ts,
        type: 'response_item',
        payload: { type: 'reasoning', summary: [{ text: String(record.thinking) }] }
      });
    }
    const hasTools = Array.isArray(record.tool_calls) && record.tool_calls.length > 0;
    if (hasTools) {
      record.tool_calls.forEach((tc, idx) => {
        const callId = tc.id || ('ag_' + (record.step_index ?? 's') + '_' + idx);
        state._agPendingCalls.push(callId);
        let argsObj = tc.args;
        if (typeof argsObj === 'string') {
          try { argsObj = JSON.parse(argsObj); } catch {}
        }
        if (argsObj && typeof argsObj === 'object' && argsObj.Path && !argsObj.path) {
          argsObj = { ...argsObj, path: argsObj.Path };
        }
        if (tc.name === 'invoke_subagent' && argsObj && typeof argsObj === 'object') {
          const unq = v => String(v || '').replace(/^"|"$/g, '').trim();
          const role = unq(argsObj.Role || argsObj.TypeName) || 'Subagente';
          const typeName = unq(argsObj.TypeName) || 'subagent';
          const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'subagent';
          const agentPath = '/root/' + slug + '_' + callId;
          state._agActiveAgents = state._agActiveAgents || [];
          state._agActiveAgents.push({ agent_path: agentPath, task_name: role, agent_name: typeName });
          out.push({
            timestamp: ts,
            type: 'event_msg',
            payload: {
              type: 'item_completed',
              item: {
                type: 'SubAgentActivity',
                kind: 'started',
                agent_path: agentPath,
                task_name: role,
                agent_name: typeName
              }
            }
          });
        }
        out.push({
          timestamp: ts,
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: tc.name || 'tool',
            arguments: typeof argsObj === 'string' ? argsObj : JSON.stringify(argsObj || {}),
            call_id: callId
          }
        });
      });
    }
    if (record.content && String(record.content).trim()) {
      out.push({
        timestamp: ts,
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: String(record.content) }] }
      });
    }
    if (!hasTools && record.status === 'DONE' && state._agInTurn) {
      if (state._agActiveAgents && state._agActiveAgents.length) {
        for (const ag of state._agActiveAgents) {
          out.push({ timestamp: ts, type: 'event_msg', payload: { type: 'item_completed', item: { type: 'SubAgentActivity', kind: 'completed', ...ag } } });
        }
        state._agActiveAgents = [];
      }
      state._agInTurn = false;
      out.push({ timestamp: ts, type: 'event_msg', payload: { type: 'task_complete' } });
    }
    return out;
  }

  if (record.type === 'GENERIC') {
    const callId = state._agPendingCalls.shift() || ('ag_out_' + (record.step_index ?? 's'));
    out.push({
      timestamp: ts,
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: callId,
        output: String(record.content || '')
      }
    });
  }
  return out;
}

module.exports = { id: 'antigravity', label: 'Antigravity', listSessions, resolveFile, normalizeRecord };
