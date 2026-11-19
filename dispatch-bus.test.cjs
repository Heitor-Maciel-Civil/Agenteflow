const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDispatchBus, buildSpecialistPrompt } = require('./dispatch-bus.cjs');

test('enqueue, listPending, poll e ack gravam .queued somente apos confirmacao', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-dispatch-'));
  const canvasInbox = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-canvas-inbox-'));
  try {
    const bus = createDispatchBus({ inboxDir: dir, planCanvasInboxDir: canvasInbox });
    const prompt = buildSpecialistPrompt({ id: 'flow-dev', note: 'Revisar popup' });
    assert.match(prompt, /flow-dev/);
    assert.match(prompt, /Revisar popup/);

    const threadId = '01a1f3c7-20ca-7c92-b37b-a7a0f59d22a9';
    const pollPromise = bus.poll({ provider: 'codex' }, 3000);
    const { item } = bus.enqueue({
      type: 'specialist_start',
      provider: 'codex',
      sessionId: threadId,
      prompt,
      autoDispatch: false
    });

    const polled = await pollPromise;
    assert.equal(polled.length, 1);
    assert.equal(polled[0].id, item.id);
    assert.equal(bus.listPending({ provider: 'codex' }).length, 1);
    const mirrored = path.join(canvasInbox, `${item.id}.json`);
    assert.equal(fs.existsSync(mirrored), true);
    assert.equal(JSON.parse(fs.readFileSync(mirrored, 'utf8')).thread, threadId);

    assert.equal(bus.ack(item.id, { transport: 'bridge' }), true);
    assert.equal(bus.listPending({ provider: 'codex' }).length, 0);
    assert.equal(fs.existsSync(path.join(dir, `${item.id}.queued`)), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(canvasInbox, { recursive: true, force: true });
  }
});

test('cliRunner respeita lock por sessionId evitando concorrencia', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-dispatch-lock-'));
  try {
    let releaseFirst;
    let calls = 0;
    const bus = createDispatchBus({
      inboxDir: dir,
      cliRunner: async () => {
        calls++;
        await new Promise(r => { releaseFirst = r; });
        return { dispatched: true, transport: 'agy-mock' };
      }
    });

    const first = bus.enqueue({ type: 'specialist_start', provider: 'antigravity', sessionId: 'conv-1', prompt: 'p1' });
    const second = bus.enqueue({ type: 'specialist_start', provider: 'antigravity', sessionId: 'conv-1', prompt: 'p2' });

    const secondRes = await second.dispatchPromise;
    assert.equal(secondRes.dispatched, false);
    assert.equal(secondRes.reason, 'session_locked');

    releaseFirst();
    const firstRes = await first.dispatchPromise;
    assert.equal(firstRes.dispatched, true);
    assert.equal(calls, 1);
    assert.equal(bus.listPending().length, 1);
    assert.equal(bus.listPending()[0].id, second.item.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
