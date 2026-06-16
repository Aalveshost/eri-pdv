# Receipt Store Header Design

## Goal

Adicionar tres campos opcionais de identificacao da loja nas configuracoes e usalos no cabecalho do cupom impresso:

- endereco
- celular
- instagram

## Current Context

- O cupom ja usa `nome_loja` vindo de `configuracoes`.
- A tela `Configuracoes.tsx` ja carrega e salva dados da loja na tabela `configuracoes`.
- O formatter textual do cupom esta concentrado em `src/pages/historicoActions.ts`.
- O PDV e o Historico montam o payload do cupom a partir desse formatter compartilhado.

## Proposed Design

### Data model

Adicionar tres colunas opcionais em `configuracoes`:

- `endereco_loja TEXT`
- `celular_loja TEXT`
- `instagram_loja TEXT`

As migracoes devem ser idempotentes, seguindo o padrao atual do projeto.

### Config screen

Na tela de configuracoes, abaixo de `Nome da loja / unidade`, adicionar tres inputs opcionais com placeholders:

- Endereco: `R. das Flores, 123`
- Celular: `(11) 9 9999-9999`
- Instagram: `@instagram`

Regras:

- Os campos podem ficar vazios.
- Se estiverem vazios, o sistema nao usa esses valores no cupom.
- O fluxo de salvar continua usando a tabela `configuracoes`.

### Receipt layout

No topo do cupom, usar o seguinte bloco:

```text
Nome da loja
Rua: ...
Celular: ...
Instagram: ...

Venda #...
Data: ...
```

Regras:

- `nome_loja` continua sendo a primeira linha.
- `Rua`, `Celular` e `Instagram` aparecem apenas quando seus respectivos valores estiverem preenchidos.
- Entre o bloco da loja e as linhas `Venda` / `Data`, inserir apenas uma linha em branco.
- Nao inserir linha pontilhada entre os dados da loja e o identificador da venda.
- O restante do cupom permanece como hoje.

### Formatting details

- Os labels do cabecalho devem ser exatamente:
  - `Rua:`
  - `Celular:`
  - `Instagram:`
- O formatter deve evitar linhas vazias extras quando um ou mais campos estiverem ausentes.
- O comportamento deve valer para impressao direta no PDV e reimpressao pelo Historico.

## Testing

Cobrir:

- Cupom com todos os campos preenchidos.
- Cupom com apenas `nome_loja`.
- Cupom com combinacoes parciais, garantindo ausencia de linhas extras e ausencia de pontilhado entre loja e venda.
- Persistencia e leitura dos novos campos em `Configuracoes.tsx`.

## Risks

- Migracao incompleta em banco antigo pode impedir leitura dos novos campos se nao seguir o padrao atual de alter table com tolerancia a erro.
- Excesso de linhas no topo pode pressionar o layout de 58 mm; o formatter deve manter o fluxo atual e apenas inserir linhas quando houver valor real.
