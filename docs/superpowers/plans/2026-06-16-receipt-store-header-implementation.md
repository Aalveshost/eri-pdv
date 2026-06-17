# Receipt Store Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar os novos campos opcionais da loja e atualizar o layout do cupom com espaco superior/inferior, total de itens, bloco de pagamento consolidado e mensagem final centralizada.

**Architecture:** A configuracao da loja continua centralizada na tabela `configuracoes`. O formatter compartilhado em `src/pages/historicoActions.ts` passa a receber os metadados opcionais da loja e monta o novo cabecalho/rodape textual usado tanto no PDV quanto na reimpressao do Historico.

**Tech Stack:** React, TypeScript, Tauri SQL, Vitest

---

### Task 1: Cobrir o novo layout do cupom com testes

**Files:**
- Modify: `src/pages/historicoActions.test.ts`

- [ ] Adicionar testes para cabecalho com `Rua/Celular/Instagram`, `Total de itens`, bloco de pagamento sem pontilhado intermediario e mensagem final centralizada.
- [ ] Executar `npx vitest run src/pages/historicoActions.test.ts` e confirmar falha inicial.

### Task 2: Implementar formatter do cupom

**Files:**
- Modify: `src/pages/historicoActions.ts`

- [ ] Estender o payload com os novos campos opcionais da loja e atualizar o texto do cupom para incluir espacos de 2 cm no topo/rodape, cabecalho opcional, total de itens, pagamento consolidado e mensagem final centralizada.
- [ ] Executar `npx vitest run src/pages/historicoActions.test.ts` e confirmar sucesso.

### Task 3: Persistir e editar os novos campos da loja

**Files:**
- Modify: `src/hooks/useDatabase.ts`
- Modify: `src/pages/Configuracoes.tsx`

- [ ] Adicionar colunas opcionais em `configuracoes` com migracao tolerante a banco antigo.
- [ ] Carregar, editar e salvar `endereco_loja`, `celular_loja` e `instagram_loja` na tela de configuracoes com placeholders definidos.

### Task 4: Levar os dados novos para PDV e Historico

**Files:**
- Modify: `src/pages/PDV.tsx`
- Modify: `src/pages/Historico.tsx`

- [ ] Incluir os campos da loja na leitura de configuracoes usada pela impressao.
- [ ] Garantir que PDV e Historico usem o mesmo formatter com o nome da loja e os campos opcionais quando houver.

### Task 5: Verificacao final

**Files:**
- Modify: `docs/superpowers/specs/2026-06-16-receipt-store-header-design.md`

- [ ] Atualizar o spec de `1,5 cm` para `2 cm` no topo e no rodape.
- [ ] Executar `npx vitest run src/pages/historicoActions.test.ts src/pages/pdvPrintFlow.test.ts`.
- [ ] Revisar visualmente o texto gerado para largura `80 mm` considerando area util de `72 mm`.
