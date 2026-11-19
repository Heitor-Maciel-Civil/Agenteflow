# Codex Flow
# Agent Flow (Codex Flow Multi-Provedor)

Servidor e visualizador local das sessoes do Codex. Inicio manual: `node start-server.cjs`.
Servidor e visualizador local das sessoes de **Codex**, **Antigravity**, **Claude Code** e **Copilot CLI**. Inicio manual: `node start-server.cjs`.
Endereco: http://localhost:4455

No VS Code deste workspace, a tarefa `Codex Flow - servidor` inicia automaticamente.
A extensao local `Heitor - Inicializar Codex Flow` abre a guia no navegador integrado.
O terminal fica separado do Codex CLI; fechar a guia nao encerra o servidor.

Esta e a copia operacional no repositorio. A pasta original `C:\Users\hreis\Downloads\worklow` foi preservada.
Instalacao e verificacao: `Repositorio/Infraestrutura/CodexFlowStartup/README.md`.

## Entrega de decisões e especialistas ao Codex

O servidor local grava as aprovações, pedidos de ajuste e vínculos de especialistas na fila de despacho. Para entrega nativa, obtenha o `CODEX_THREAD_ID` da conversa atual e armazene `{ threadId, since }` com a chave `agentFlowCodexBridge` no store de `functions.exec`. Use o horário de início em milissegundos, ou a data do evento específico autorizado para recuperação. Execute o conteúdo de `codex-bridge-runtime.mjs` no runtime de ferramentas. Mantenha um receptor por thread.

O receptor aceita a thread exata ou o arquivo de sessão Codex correspondente. Eventos sem destinatário e de outras conversas ficam na fila. O marcador de entrega só é escrito após aceitação pela ferramenta nativa. O receptor dura enquanto o runtime da conversa estiver ativo. Reiniciar o servidor web não inicia a ponte automaticamente.

Desempenho: somente nos do viewport sao montados; a fisica usa vizinhanca espacial,
ate 30 atualizacoes/s durante acomodacao e pausa em guia oculta. A distancia muda
gradualmente no zoom; o movimento desacelera por energia, sem corte por tempo.
Comandos aparecem como resumo da acao e resultado, sem codigo bruto. Links sao retas
com marcadores de destino reutilizados. Logs chegam em blocos de 256 KB, com
previas textuais limitadas a 32 KB por campo e imagens locais carregadas sob demanda.
Os JSONL originais permanecem integrais. Teste: `node performance.test.cjs`.

Arquivos e imagens com caminhos explicitos ganham nos ligados ao comando que os
utilizou (recurso -> comando). Ficam em leque externo, proximo de 180 graus da
entrada do comando, com atracao local ao comando. Clique abre diff registrado no
patch ou previa atual de leitura/imagem no flutuante. Sem patch registrado, nao se
inventa comparacao historica. Previas de texto limitadas a256KB e carregadas no clique.

Cada pedido reserva area proporcional aos seus ramos e recursos; links entre pedidos
respeitam esse alcance e os ramos usam atracao local. O indicador de carregamento
usa `assets/setas.svg`, copia do SVG fornecido pelo usuario. Chamadas view_image em
codigo freeform tambem sao reconhecidas. Imagens aparecem somente como icone no
grafo; os bytes sao carregados apenas ao clicar, sem miniatura automatica.

O servidor preserva imagens registradas em `data/images`, antes de remover base64
dos eventos enviados ao navegador. Copias em disco sao deduplicadas e identificadas
por sessao/caminho/chamada, preservando reutilizacoes de arquivos temporarios.
O original pode ser apagado depois da captura. Imagens antigas ja apagadas e sem
dados recuperaveis no log nao podem ser reconstruidas. Teste: `node image-store.test.cjs`.

Comprimentos por hierarquia: pedido -> hub um pouco maior, hub -> secundarios
mais curto, recursos em leque compacto de ate3 por faixa. A regra do tronco entre
pedidos e preservada. Ramos compartilham um lado do tronco, com margem suave para
reduzir cruzamentos das linhas secundarias com a ligacao principal.

A interface usa tema monocromatico, glifos `.` nitidos na malha e a fonte local
`Departure Mono` (com fallback monospace). A malha acompanha pan/zoom e tem tres
densidades: abaixo de 0,35, grade espacada e apenas baloes de pedidos; de 0,35 a
1,2, grade media e todos os nos; acima de 1,2, grade fina. O cursor movimenta uma
resposta local com leve atraso e deformacao organica tipo geoide: o limite que revela
os pontos tem variacao horizontal e ondulacoes que aumentam em amplitude e frequencia
com a velocidade do cursor, com uma faixa de transicao suave que mantem largura visual
no zoom. O realce ilumina apenas os pontos de intersecao da malha, mantendo estaticos
os glifos tipograficos do fundo. Uma malha ortogonal adicional de linhas discretas e
pontos nas intersecoes ocupa somente o viewport e uma margem, permanece alinhada
durante pan/zoom e se deforma localmente em torno do cursor suavizado; cada ponto
iluminado acrescenta uma forca secundaria fraca, limitada em conjunto a 30% da
deformacao principal. Durante uma acao em andamento, cada ponto aceso do spinner
tambem contribui com 12% de forca secundaria; a transicao acompanha o brilho, e todas
as fontes secundarias continuam limitadas em conjunto a 30%. Elas param ao terminar a
atividade. Nenhuma dessas fontes altera nos, links ou fisica do historico. Movimento
reduzido mantem a malha sem deformacao. O cursor nao exibe um circulo em volta. Nao
ha glow continuo.
As orbitas e os contornos dos nos
permanecem circulares. As conexoes
ficam solidas e so a linha clicada vira um rastro de hifens `-` animado; hover nao
inicia essa animacao. Selecionar um no revela tres niveis de atracao: raios e forcas
usam importancia, conexoes e tamanho do pedido; o zoom altera a exibicao, nao a forca
do campo. O no selecionado tambem recupera a orbita pontilhada giratoria, com
velocidade lenta e passos discretos. Os tres aneis de forca percorrem seus tracos em
velocidades diferentes e escurecem progressivamente para fora. A grade, os glifos e
as linhas SVG usam antialiasing de qualidade geometrica em vez de bordas forcadas
pixel a pixel. Os nos de maior importancia usam tons de cinza mais claros. A animacao
de processamento mostra oito pontos estacionarios ao redor do no ativo: o brilho
percorre os pontos sem desloca-los, e o diametro acompanha o tamanho do no. Todas as
animacoes respeitam `prefers-reduced-motion`.

## HUD de agentes (opt-in)

O HUD mostra sinais de ciclo de vida expostos pelos provedores. Ele nao detecta
atividade pela existencia de um processo e nao inicia, interrompe ou envia
tarefas. O estado do Codex representa somente a sessao exibida na pagina.

Superficies cobertas por hooks opt-in:

- Antigravity App, CLI e IDE.
- Copilot CLI. **Copilot Chat/Fusion no VS Code nao e monitorado**: a API publica
  de extensoes do VS Code nao expoe um evento geral para observar o estado de
  execucao do chat integrado. Assim, "Sem sinal" para Copilot CLI nao significa
  que o chat do VS Code esteja inativo.
- Claude Code CLI, IDE e aba Code do Desktop; conversas comuns do Claude nao
  sao cobertas.

O relay `agent-hook.cjs` recebe o JSON do hook localmente, seleciona apenas o
provedor, evento, identificadores necessarios em memoria, estado e nome do
workspace, e envia o registro sanitizado somente para `127.0.0.1:4455`. Prompts,
transcricoes, ferramentas e credenciais nao sao enviados nem persistidos. O
servidor deve estar ativo; `CODEX_FLOW_PORT` pode apontar para outra porta local.
Sinais nao terminais ficam desconhecidos apos cinco minutos; eventos encerrados
expiram apos um minuto.

Os exemplos abaixo sao opcionais e nao foram instalados. Mescle-os com os hooks
existentes do provedor, sem substituir configuracoes pessoais. Em Windows, `node`
precisa estar no `PATH`. Os caminhos absolutos apontam para esta copia do
workspace; ajuste-os se a pasta mudar.

### Antigravity

Mescle os eventos a seguir em `.agents/hooks.json` na raiz do workspace que deseja
acompanhar:

```json
{
  "codex-flow-status": {
    "SessionStart": [
      { "type": "command", "command": "node \"X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs\" antigravity SessionStart" }
    ],
    "PreInvocation": [
      { "type": "command", "command": "node \"X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs\" antigravity PreInvocation" }
    ],
    "PostInvocation": [
      { "type": "command", "command": "node \"X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs\" antigravity PostInvocation" }
    ],
    "Stop": [
      { "type": "command", "command": "node \"X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs\" antigravity Stop" }
    ]
  }
}
```

### Copilot CLI

Crie um arquivo opcional como `.github/hooks/codex-flow.json` no repositorio
usado pelo Copilot CLI e mescle os eventos necessarios. No Windows, os hooks do
CLI requerem PowerShell 7 ou posterior no `PATH`.

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "type": "command", "powershell": "node \"X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs\" copilot sessionStart", "timeoutSec": 5 }
    ],
    "userPromptSubmitted": [
      { "type": "command", "powershell": "node \"X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs\" copilot userPromptSubmitted", "timeoutSec": 5 }
    ],
    "agentStop": [
      { "type": "command", "powershell": "node \"X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs\" copilot agentStop", "timeoutSec": 5 }
    ],
    "sessionEnd": [
      { "type": "command", "powershell": "node \"X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs\" copilot sessionEnd", "timeoutSec": 5 }
    ]
  }
}
```

### Claude Code

Mescle os eventos em `.claude/settings.json` do projeto (ou em
`.claude/settings.local.json` para uma configuracao local nao compartilhada):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs", "claude", "SessionStart"] }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs", "claude", "UserPromptSubmit"] }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs", "claude", "Stop"] }] }
    ],
    "StopFailure": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs", "claude", "StopFailure"] }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs", "claude", "SessionEnd"] }] }
    ],
    "SubagentStart": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs", "claude", "SubagentStart"] }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["X:\\Lip's AutoCAD\\Lisps Heitor\\Aplicativos\\CodexFlow\\agent-hook.cjs", "claude", "SubagentStop"] }] }
    ]
  }
}
```

Referencias: [hooks do Antigravity](https://antigravity.google/docs/hooks/),
[hooks do Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks)
e [hooks do Claude Code](https://code.claude.com/docs/en/hooks). A [API do
VS Code](https://code.visualstudio.com/api/references/vscode-api#chat) documenta
criacao de participantes de chat, mas nao eventos gerais para observar o Copilot
Chat/Fusion integrado.
