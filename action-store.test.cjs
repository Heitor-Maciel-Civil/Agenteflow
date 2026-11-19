const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createDispatchBus } = require('./dispatch-bus.cjs');
const { createActionStore } = require('./action-store.cjs');

test('recordDecision grava decisao imutavel e dispara inicio instantaneo em approved', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-actions-'));
  try {
    const inboxDir = path.join(root, 'inbox');
    const decisionsDir = path.join(root, 'decisions');
    const readyDir = path.join(root, 'ready');
    fs.mkdirSync(readyDir, { recursive: true });

    const planFile = path.join(root, 'PLANO_TESTE.md');
    fs.writeFileSync(planFile, '# Plano Teste\n\nEtapa 1');
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(planFile)).digest('hex');
    const rev = '11111111-2222-3333-4444-555555555555';
    fs.writeFileSync(path.join(readyDir, 'sig.json'), JSON.stringify({
      revision: rev,
      file: 'PLANO_TESTE.md',
      sha256,
      publishedAt: Date.now()
    }));

    const bus = createDispatchBus({ inboxDir });
    const store = createActionStore({ decisionsDir, readyDir, workspaceRoot: root, dispatchBus: bus });

    const scanned = store.scanReadyPlans();
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0].title, 'Plano Teste');
    assert.equal(scanned[0].decision, null);

    const waitP = store.waitForDecision(rev, 3000);
    const { record, dispatch } = store.recordDecision({
      revision: rev,
      decision: 'approved',
      file: 'PLANO_TESTE.md',
      sha256,
      provider: 'antigravity',
      sessionId: 'conv-abc'
    });

    const waited = await waitP;
    assert.equal(waited.decision, 'approved');
    assert.equal(record.revision, rev);
    assert.ok(dispatch && dispatch.item);
    assert.equal(dispatch.item.type, 'plan_approved');
    assert.match(dispatch.item.prompt, /APROVADO/);
    assert.equal(bus.listPending().length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
