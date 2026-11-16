'use strict';
const fs = require('node:fs');
// Projecao apenas para o visualizador; o JSONL original permanece intacto.
function compact(value) {
  if (typeof value === 'string') {
    if (/^data:image\//.test(value)) return '';
    return value.length > 32768 ? value.slice(0, 32768) + '\n[Previa limitada; conteudo integral no log original.]' : value;
  }
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') { const out = {}; for (const key of Object.keys(value)) out[key] = compact(value[key]); return out; }
  return value;
}
function readBatch(file, state, bytes = 262144) {
  const size = fs.statSync(file).size;
  if (size < state.offset) { state.offset = 0; state.pending = Buffer.alloc(0); state.dropping = false; }
  const length = Math.min(bytes, size - state.offset); if (!length) return [];
  const fd = fs.openSync(file, 'r'), buffer = Buffer.allocUnsafe(length);
  let count; try { count = fs.readSync(fd, buffer, 0, length, state.offset); } finally { fs.closeSync(fd); }
  state.offset += count;
  const data = Buffer.concat([state.pending || Buffer.alloc(0), buffer.subarray(0, count)]), end = data.lastIndexOf(10);
  if (end < 0) { if (data.length > 8388608) { state.pending = Buffer.alloc(0); state.dropping = true; } else state.pending = data; return []; }
  let lines = data.subarray(0, end).toString('utf8').split('\n');
  if (state.dropping) { lines.shift(); state.dropping = false; }
  state.pending = Buffer.from(data.subarray(end + 1));
  return lines.flatMap(line => { try { const record=JSON.parse(line);if(state.onRecord)try{state.onRecord(record)}catch{}return [compact(record)]; } catch { return []; } });
}
module.exports = { compact, readBatch };
