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
[espaco superior extra]

Nome da loja
Rua: ...
Celular: ...
Instagram: ...

Venda #...
Data: ...
```

Regras:

- Inserir espaco superior extra equivalente a aproximadamente `1,5 cm` antes da primeira linha impressa.
- `nome_loja` continua sendo a primeira linha.
- `Rua`, `Celular` e `Instagram` aparecem apenas quando seus respectivos valores estiverem preenchidos.
- Entre o bloco da loja e as linhas `Venda` / `Data`, inserir apenas uma linha em branco.
- Nao inserir linha pontilhada entre os dados da loja e o identificador da venda.
- Na parte final, inserir espaco inferior extra equivalente a aproximadamente `1,5 cm` apos a mensagem de encerramento.
- O restante do cupom permanece como hoje, com os ajustes abaixo no fechamento.

### Formatting details

- Os labels do cabecalho devem ser exatamente:
  - `Rua:`
  - `Celular:`
  - `Instagram:`
- O formatter deve evitar linhas vazias extras quando um ou mais campos estiverem ausentes.
- O comportamento deve valer para impressao direta no PDV e reimpressao pelo Historico.

### Receipt footer

Na parte final do cupom, usar a seguinte estrutura:

```text
--------------------------------
Total de itens: ...

Pagamento:
- ...
Total: R$ ...
--------------------------------
      Obrigado pela preferencia!
           Volte sempre!
```

Regras:

- `Total de itens:` deve mostrar o total de unidades vendidas, ou seja, a soma de `quantidade` de todos os itens do cupom.
- `Pagamento:` continua listando um ou mais metodos conforme as regras ja definidas anteriormente.
- Em pagamento com dinheiro, manter tambem a linha de troco quando houver.
- Em pagamento de crediario, manter o formato `Crediario: idcliente - nome_cliente`.
- O `Total: R$ ...` deve ficar dentro do mesmo bloco visual de pagamento, sem uma linha pontilhada separando pagamentos e total.
- Depois do bloco de pagamento e total, inserir uma linha pontilhada.
- A mensagem final deve ser exatamente:
  - `Obrigado pela preferencia!`
  - `Volte sempre!`
- As duas linhas da mensagem final devem ser centralizadas dentro da largura util do cupom.

## Testing

Cobrir:

- Cupom com todos os campos preenchidos.
- Cupom com apenas `nome_loja`.
- Cupom com combinacoes parciais, garantindo ausencia de linhas extras e ausencia de pontilhado entre loja e venda.
- Cupom com validacao de espaco superior e inferior extra no layout final.
- Cupom com `Total de itens` baseado na soma das quantidades.
- Cupom com total permanecendo dentro do bloco de pagamento, sem pontilhado intermediario.
- Cupom com mensagem final centralizada.
- Persistencia e leitura dos novos campos em `Configuracoes.tsx`.

## Risks

- Migracao incompleta em banco antigo pode impedir leitura dos novos campos se nao seguir o padrao atual de alter table com tolerancia a erro.
- Excesso de linhas no topo pode pressionar o layout de 58 mm; o formatter deve manter o fluxo atual e apenas inserir linhas quando houver valor real.
