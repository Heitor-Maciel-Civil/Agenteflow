# Findings: Agent Flow Multi-Provedor e Subagentes

## Estado Atual (12/11/2026)
- `codex-flow.js` lê apenas `CODEX_HOME/sessions` (`rollout-*.jsonl`).
- `agent-status.cjs` e `agent-hook.cjs` já suportam eventos de status (`idle`, `running`, `ended`) para `antigravity`, `copilot` (CLI) e `claude` (Claude Code), mas os hooks opt-in ainda não foram instalados no workspace.
- `PlanCanvas` (`publish-plan.js`) é universal; apenas a ponte de comentários (`bridge-runtime.mjs`) depende do runtime do Codex (`CODEX_THREAD_ID`).

## Achados da Tarefa Atual (16/11/2026)
- **Deformação da malha (`index.html` linhas 329-330, 440-449, 894):** `drawGraph()` marca `.processing` e cria `ensureActivityOrbit(s)` para todos os nós em `activeSet = processingNodes(visible)`, mas `meshActivityNode` recebe apenas um único nó (`processingNode(visible)`), fazendo com que os demais nós ativos simultâneos (como subagentes + comandos) não deformem a malha.
- **Corte de saída dos traços (`index.html` linhas 882-884):** `routedLink(e)` divide o raio por `direction = Math.max(Math.abs(dx), Math.abs(dy)) / d` quando `size >= 84` (caso dos subagentes `kind === 'agent'`), gerando um recorte quadrado (caixa invisível) em torno do ícone circular.
- **Ícones e cores dos subagentes (`index.html` linhas 112, 336, 769):** Todos os subagentes usam o mesmo `robotIcon`, `agentColor` retorna apenas tons de cinza e `#world .node-icon` aplica `filter: grayscale(1)`. Os 8 SVGs em `Recursos/Icones/Subagentes_32x32_brancos/` (`robo-coordenador`, `robo-designer`, `robo-documentador`, `robo-executor`, `robo-pesquisador`, `robo-programador`, `robo-revisor`, `robo-testador`) já estão disponíveis em `32x32`.
- **Escopo de comandos de subagentes (`index.html` linhas 733-742 e `codex-flow.js` linhas 112-139):** `loadAgentCommands()` carrega todos os comandos e raciocínios do arquivo do subagente e mantém todos os balões concluídos no grafo durante todo o contexto, em vez de mostrar apenas os comandos em execução no pedido atual.
