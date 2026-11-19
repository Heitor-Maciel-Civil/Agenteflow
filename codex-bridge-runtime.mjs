// Execute inside functions.exec, where the native Codex thread tool is available.
const config = load('agentFlowCodexBridge');
const uuid = /^[a-f0-9-]{36}$/i;
const supported = new Set(['plan_approved', 'plan_feedback', 'specialist_start']);
if (!config || !uuid.test(config.threadId) || !Number.isSafeInteger(config.since)) {
  throw new Error('Informe a thread Codex atual e o instante de início do receptor.');
}

const thread = config.threadId.toLowerCase();
function targetsCurrentThread(item) {
  const session = String(item.sessionId || '').toLowerCase();
  return session === thread || (
    /^(?:\d{4}\/\d{2}\/\d{2}\/)?rollout-[\dt-]+-[a-f0-9-]{36}\.jsonl$/.test(session)
      && session.endsWith('-' + thread + '.jsonl')
  );
}

const pollCommand = [
  "$items = Invoke-RestMethod -Uri 'http://127.0.0.1:4455/api/dispatch/poll?provider=codex&timeout=10000' -TimeoutSec 15 -ErrorAction Stop",
  '$items | Select-Object id,type,provider,sessionId,createdAt | ConvertTo-Json -Compress'
].join('\n');
const delivered = new Set();
text({ agentFlowBridge: 'listening', thread });
await yield_control();

for (;;) {
  try {
    const response = await tools.exec_command({ cmd: pollCommand, yield_time_ms: 20000 });
    if (response.exit_code !== 0) throw new Error('Consulta à fila Agent Flow falhou.');
    const parsed = response.output.trim() ? JSON.parse(response.output) : [];
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (!uuid.test(item.id) || item.provider !== 'codex' || !supported.has(item.type)
        || item.createdAt < config.since || !targetsCurrentThread(item)) continue;
      if (!delivered.has(item.id)) {
        const result = await tools.mcp__codex_tui__send_message_to_thread({
          threadId: thread,
          prompt: '[Agent Flow] Leia o evento desta conversa em Aplicativos/CodexFlow/data/inbox/'
            + item.id + '.json. Confira a ação original, preserve o escopo e não repita trabalho em andamento.'
        });
        if (result.isError || (result.content || []).some(block => block.type === 'text' && /failed|error|not found/i.test(block.text))) {
          throw new Error('A ferramenta nativa não aceitou o evento.');
        }
        delivered.add(item.id);
      }
      const ack = await tools.exec_command({
        cmd: "$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4455/api/dispatch/ack' "
          + "-ContentType 'application/json' -Body '{\"id\":\"" + item.id
          + "\",\"transport\":\"codex-native-thread\"}' -TimeoutSec 5 -ErrorAction Stop\n"
          + "if (!$response.ok) { throw 'ACK recusado' }"
      });
      if (ack.exit_code !== 0) throw new Error('Confirmação da entrega falhou.');
      delivered.delete(item.id);
      notify({ agentFlowBridge: 'delivered', id: item.id, type: item.type });
    }
  } catch (error) {
    notify({ agentFlowBridge: 'retrying', reason: error.message });
  }
  await new Promise(resolve => setTimeout(resolve, 3000));
}
