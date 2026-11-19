#!/usr/bin/env node
const { createActionStore } = require('./action-store.cjs');

const args = process.argv.slice(2);
const revIdx = args.indexOf('--rev');
const timeoutIdx = args.indexOf('--timeout');
const revision = revIdx >= 0 ? args[revIdx + 1] : args[0];
const timeoutMs = timeoutIdx >= 0 ? Number(args[timeoutIdx + 1]) : 0;

if (!revision) {
  console.error('Uso: node wait-decision.cjs --rev <revision> [--timeout <ms>]');
  process.exit(2);
}

const store = createActionStore();
const start = Date.now();

function check() {
  const decision = store.getDecision(revision);
  if (decision) {
    console.log(JSON.stringify(decision));
    process.exit(0);
  }
  if (timeoutMs > 0 && Date.now() - start >= timeoutMs) {
    console.log(JSON.stringify({ status: 'timeout', revision }));
    process.exit(1);
  }
  setTimeout(check, 1000);
}

check();
