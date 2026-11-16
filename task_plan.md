# Task Plan: Agent Flow — Malha Simultânea e Subagentes (Ícones 1–8, Traços Circulares, Escopo de Comandos e Dock Superior Direito)

## Objetivo
1. Fazer todos os pontos simultaneamente em execução (incluindo subagentes e seus comandos ativos) deformarem e iluminarem a malha de fundo.
2. Corrigir o corte de saída dos traços dos nós circulares (como subagentes) para saírem diretamente do símbolo circular sem recortar uma caixa vazia.
3. Variar subagentes de 1 a 8 usando os ícones SVG de `Recursos/Icones/Subagentes_32x32_brancos/` e 8 cores distintas, sem repetir ícones seguidos no mesmo pedido.
4. Mostrar nos subagentes apenas os comandos em execução no momento daquele pedido, sem acumular todos os balões históricos do contexto.
5. Adicionar botões no canto superior direito mostrando os ícones dos subagentes que trabalharam na conversa com um resumo breve sobre o que fazem.

## Fases

### Phase 1: Planejamento e Publicação Visual
**Status:** complete
- Plano detalhado criado em `docs/superpowers/plans/2026-11-16-agent-flow-subagentes-malha.md`.
- Publicado no PlanCanvas (`12b8bbe8-dbf6-4578-b632-5d5d83f1f539`) e confirmado em `monitor-acks.json`. Aguardando aprovação explícita do usuário.

### Phase 2: Deformação Simultânea da Malha e Saída Circular dos Traços
**Status:** complete
- Expandido `stepActivityMeshSources` para todos os nós em `processingNodes(visible)` e ajustado `routedLink` para raio circular exato.

### Phase 3: Variação de Subagentes (1 a 8 Ícones e Cores)
**Status:** complete
- Embutidos os 8 SVGs de `Recursos/Icones/Subagentes_32x32_brancos/` e paleta de 8 cores sem repetição consecutiva.

### Phase 4: Escopo de Comandos Ativos por Pedido e Dock Superior Direito
**Status:** complete
- Mantidos apenas comandos em execução no pedido atual para subagentes e criado `#subagentsDock` no canto superior direito com resumo breve.

### Phase 5: Testes Automatizados e Validação Final
**Status:** complete
- Executados `performance.test.cjs` e suíte `node --test` (12/12 passando).
