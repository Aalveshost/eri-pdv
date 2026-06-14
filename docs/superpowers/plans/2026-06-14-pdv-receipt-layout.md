# PDV Receipt Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atualizar o cupom da venda para remover o metodo de pagamento do topo, usar itens em linha unica truncada no layout de 80 mm e mover o resumo de pagamentos para o rodape.

**Architecture:** Concentrar a mudanca no formatter compartilhado de impressao para preservar o fluxo atual do PDV e do Historico. Ajustar apenas os payloads que montam titulo/subtitulo para o PDV e manter compatibilidade com 58 mm e impressao de vendas a prazo.

**Tech Stack:** React, TypeScript, Vitest, Tauri

---

### Task 1: Cobrir o novo layout com testes

**Files:**
- Modify: `src/pages/historicoActions.test.ts`

- [ ] Adicionar teste para o layout de 80 mm com cabecalho limpo, item truncado em linha unica e pagamentos no rodape.
- [ ] Rodar `npm test -- src/pages/historicoActions.test.ts` e verificar falha inicial.

### Task 2: Implementar formatter do cupom

**Files:**
- Modify: `src/pages/historicoActions.ts`

- [ ] Atualizar o texto impresso para ordenar como cabecalho, itens, pagamentos e total.
- [ ] Implementar linha unica truncada para itens em 80 mm, mantendo 58 mm no formato atual.
- [ ] Preservar fallback sem itens e sem pagamentos.

### Task 3: Ajustar payloads do PDV

**Files:**
- Modify: `src/pages/PDV.tsx`

- [ ] Alterar o subtitulo da impressao do PDV para `Venda #id`.
- [ ] Continuar enviando os detalhes de pagamentos para o rodape quando houver mais de um metodo.

### Task 4: Verificar regressao

**Files:**
- Verify: `src/pages/historicoActions.test.ts`
- Verify: `src/pages/pdvPayments.test.ts`
- Verify: `src/pages/receiptPaperWidth.test.ts`

- [ ] Rodar os testes relacionados ao formatter e pagamentos.
- [ ] Revisar o texto final gerado nos cenarios de 58 mm e 80 mm.
