# PDV Pagamentos Mistos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir vendas com um ou mais meios de pagamento, migrando o historico existente sem perda de dados e mantendo relatorios, historico e impressao corretos.

**Architecture:** A tabela `vendas` continua como registro principal da venda, com `metodo_pagamento` mantido por compatibilidade visual e operacional. A nova tabela `venda_pagamentos` passa a ser a fonte de verdade para relatorios, detalhes e impressao, e recebe uma migracao que converte vendas antigas para um unico pagamento vinculado.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri SQL plugin, SQLite

---

### Task 1: Extrair regras de pagamentos mistos

**Files:**
- Create: `src/pages/pdvPayments.ts`
- Test: `src/pages/pdvPayments.test.ts`

- [ ] **Step 1: Write the failing test**

Criar testes cobrindo:
- soma dos pagamentos lancados
- calculo de restante
- identificacao de troco em dinheiro
- determinacao do metodo resumo (`credito`, `dinheiro`, `misto`)
- linhas de impressao por pagamento

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/pages/pdvPayments.test.ts`
Expected: FAIL because `pdvPayments.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implementar utilitarios para:
- normalizar pagamentos do checkout
- resumir status financeiro da venda
- montar label e linhas detalhadas de pagamento para impressao/historico

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/pages/pdvPayments.test.ts`
Expected: PASS

### Task 2: Migrar banco e persistencia

**Files:**
- Modify: `src/hooks/useDatabase.ts`
- Modify: `src/utils/fifoEngine.ts`

- [ ] **Step 1: Write the failing test**

Cobrir a regra de resumo de pagamentos antigos/novos no utilitario criado na Task 1, para que a persistencia use contratos estaveis.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/pages/pdvPayments.test.ts`
Expected: FAIL when asserting comportamento ainda nao implementado para resumo/migracao.

- [ ] **Step 3: Write minimal implementation**

Adicionar:
- `CREATE TABLE IF NOT EXISTS venda_pagamentos`
- migracao `INSERT ... SELECT` para converter vendas antigas
- gravacao de pagamentos ao finalizar venda

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/pages/pdvPayments.test.ts`
Expected: PASS

### Task 3: Adaptar checkout do PDV

**Files:**
- Modify: `src/pages/PDV.tsx`
- Modify: `src/pages/pdvCashFlow.ts`
- Test: `src/pages/pdvCashFlow.test.ts`

- [ ] **Step 1: Write the failing test**

Adicionar testes para o resumo financeiro do checkout:
- total lancado
- restante
- troco quando dinheiro exceder total

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/pages/pdvCashFlow.test.ts src/pages/pdvPayments.test.ts`
Expected: FAIL for new mixed-payment expectations.

- [ ] **Step 3: Write minimal implementation**

Atualizar checkout para:
- adicionar/remover lancamentos
- exibir total a pagar, total lancado e restante
- confirmar apenas quando o total fechar

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/pages/pdvCashFlow.test.ts src/pages/pdvPayments.test.ts`
Expected: PASS

### Task 4: Adaptar historico, impressao e relatorios

**Files:**
- Modify: `src/pages/Historico.tsx`
- Modify: `src/pages/historicoActions.ts`
- Modify: `src/pages/PDV.tsx`
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Write the failing test**

Expandir `src/pages/pdvPayments.test.ts` para verificar:
- rotulo `Misto`
- detalhes discriminados por meio
- linhas de impressao ordenadas

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/pages/pdvPayments.test.ts`
Expected: FAIL for detail/print formatting.

- [ ] **Step 3: Write minimal implementation**

Atualizar consultas e payloads para:
- buscar pagamentos por venda
- somar totais por metodo a partir de `venda_pagamentos`
- imprimir `Credito: R$ x`, `Debito: R$ y`, etc.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/pages/pdvPayments.test.ts`
Expected: PASS

### Task 5: Verificacao final

**Files:**
- Modify: `.vercelignore` only if needed (expected no change)

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/pages/pdvPayments.test.ts src/pages/pdvCashFlow.test.ts`
Expected: PASS

- [ ] **Step 2: Run app build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Sanity check Tauri startup**

Run: `./script/build_and_run.sh --verify`
Expected: `tauri-app is running`
