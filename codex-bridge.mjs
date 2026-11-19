// Run inside functions.exec, where the native Codex thread tool is available.
const source = await tools.exec_command({
  cmd: 'Get-Content -Raw -Encoding UTF8 Aplicativos/CodexFlow/codex-bridge-runtime.mjs',
  max_output_tokens: 6000
});
if (source.exit_code !== 0) throw new Error('Não foi possível carregar a ponte Codex.');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
await new AsyncFunction(source.output)();
