# Extrator de Boleto

Servidor Node.js que extrai automaticamente os dados de boletos bancários brasileiros a partir de uma URL de PDF. Possui painel web com autenticação, integração com WhatsApp via Baileys e endpoints separados para extração e envio.

---

## O que ele faz

- Recebe a URL de um PDF de boleto
- Baixa o PDF, extrai o texto e identifica a linha digitável, o valor e o vencimento
- O valor é decodificado diretamente do código de barras quando não está explícito no texto
- Expõe os dados via API REST (extração e envio são endpoints separados)
- Salva os PDFs localmente em `boletos/MM-YYYY/` com rotação automática de 3 meses
- Painel web protegido por senha para gerenciar a conexão WhatsApp e testar extrações e envios
- Endpoint público `/status` para monitoramento externo (barra de tarefas, N8N, etc.)
- Notificação automática via WhatsApp para um número configurável em caso de erro no envio

---

## Instalação

```bash
npm install
```

Crie o arquivo `.env` na raiz:

```env
PASSWORD=Paiol2026@@
OWNER_PHONE=11999999988
ADMIN_PHONE=5535991500311
PORT=3001
```

- `PASSWORD` — senha de acesso ao painel
- `OWNER_PHONE` — número que receberá a senha via "Esqueci a senha" (DDD + número, só dígitos)
- `ADMIN_PHONE` — número padrão para notificações de erro (pode ser alterado pelo painel)
- `PORT` — porta do servidor (padrão: 3001)

---

## Como rodar

```bash
node server.js
```

Acesse o painel em: `http://localhost:3001/painel`

### Produção (Hostinger Node.js Web App)

Faça upload do zip com `server.js`, `package.json`, `package-lock.json` e `.env` pelo painel da Hostinger.
A Hostinger instala as dependências e inicia automaticamente via `npm start`.

Acesse o painel em: `https://boletos.vilapaiol.com.br/painel`

---

## Endpoints

### `POST /extract-boleto`
Extrai os dados de um boleto a partir da URL do PDF. O PDF é salvo em `boletos/MM-YYYY/`.

**Sem autenticação** — use diretamente no N8N, Make, scripts, etc.

**Body:**
```json
{ "url": "https://www.bling.com.br/doc.view.php?id=..." }
```

**Resposta:**
```json
{
  "codigoBarras": "63390.00116 12252.498600 05923.197031 1 13920000053708",
  "valor": "R$ 537,08",
  "vencimento": "22/03/2026",
  "pagador": "Bar do Vitin"
}
```

**Erros possíveis:**
| Status | Motivo |
|--------|--------|
| 400 | URL não informada |
| 422 | PDF sem código de barras detectável |
| 502 | Falha ao baixar o PDF |
| 504 | Timeout ao baixar o PDF |

---

### `POST /send-boletos`
Extrai os dados de um ou mais boletos e envia uma mensagem formatada via WhatsApp.

**Sem autenticação** — use diretamente no N8N, Make, scripts, etc.

Se a extração de qualquer boleto falhar, **nenhuma mensagem é enviada ao cliente** — o erro é notificado automaticamente para o número de notificação configurado no painel.

**Body:**
```json
{
  "phone": "11999999988",
  "nome": "Bar do Vitin",
  "referencia": "PED-001",
  "boletos": [
    { "url": "https://www.bling.com.br/doc.view.php?id=..." },
    { "url": "https://www.bling.com.br/doc.view.php?id=..." }
  ]
}
```

- `phone` — obrigatório — número do destinatário (DDD + número)
- `nome` — opcional — nome do cliente (se omitido, usa o pagador extraído do PDF)
- `referencia` — opcional — identificador do pedido/compra
- `boletos` — obrigatório — array de objetos com `url`

**Mensagem gerada:**
```
Olá *Bar do Vitin*, tudo bem?
Seguem os boletos ref. a compra PED-001...

(1/2) - Venc: 22/03/2026 - R$ 358,97
https://...

(2/2) - Venc: 25/03/2026 - R$ 120,00
https://...
```

**Resposta:**
```json
{ "success": true, "parcelas": 2 }
```

---

### `GET /status`
Retorna o status da conexão WhatsApp em JSON.

**Sem autenticação** — ideal para monitoramento externo.

**Resposta:**
```json
{
  "connected": true,
  "connecting": false,
  "phone": "5511999999988"
}
```

---

### `POST /forgot-password`
Envia a senha do painel para o número configurado em `OWNER_PHONE` via WhatsApp, com delay de **3 minutos**.

Requer que o WhatsApp esteja conectado.

---

### Demais rotas (requerem login)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Painel principal |
| `GET` | `/painel` | Página de login |
| `GET` | `/painel-sair` | Encerra a sessão |
| `POST` | `/painel` | Autentica com senha |
| `POST` | `/connect` | Inicia conexão WhatsApp (gera QR ou código de pareamento) |
| `POST` | `/disconnect` | Desconecta e apaga sessão |
| `GET` | `/qr` | QR Code atual em base64 (para o painel) |
| `GET` | `/settings` | Retorna configurações (recoveryPhone, notificationPhone) |
| `POST` | `/settings` | Salva recoveryPhone ou notificationPhone |

---

## Armazenamento de PDFs

Os PDFs baixados são salvos automaticamente em:

```
boletos/
  03-2026/
    22032026-123456.pdf   ← datavenc-id.pdf
  04-2026/
    ...
```

- Pasta criada automaticamente no primeiro boleto do mês
- Nome do arquivo: `DDMMAAAA-ID.pdf` (data de vencimento + ID da URL)
- Rotação automática: mantém o mês atual + 3 meses anteriores. Ao iniciar um novo mês, a pasta mais antiga é removida
- Acessível via URL direta: `https://boletos.vilapaiol.com.br/boletos/03-2026/22032026-123456.pdf` (sem listagem de diretório)

---

## Painel Web

Acesse `https://boletos.vilapaiol.com.br/painel` e entre com a senha configurada no `.env`.

O painel exibe:

- **Status da conexão** — dot colorido no cabeçalho (verde/amarelo/vermelho)
- **Conectar WhatsApp** — via QR Code ou código de pareamento por número
- **Desconectar** — encerra a sessão e apaga os dados de autenticação
- **Recuperação de Senha** — configura o número que receberá a senha via WhatsApp
- **Notificacao para Erros de Envio de Boleto** — configura o número que recebe alertas de falha
- **Extrair Boleto** — cola a URL, retorna linha digitável, valor e vencimento
- **Enviar Boleto via WhatsApp** — cola URL + telefone e dispara a mensagem diretamente

---

## Fluxo sugerido no N8N

```
Nó 1: POST /extract-boleto  →  armazena codigoBarras, valor, vencimento
Nó 2: busca dados extras (nome do cliente, referência do pedido, etc.)
Nó 3: POST /send-boletos    →  envia a mensagem com todos os dados combinados
```

---

## WhatsApp

A integração usa [Baileys](https://github.com/WhiskeySockets/Baileys), que conecta via WhatsApp Web sem API oficial.

**Para conectar via QR:**
1. Clique em **Conectar** no painel
2. Escaneie o QR Code com o WhatsApp (Dispositivos conectados → Conectar dispositivo)
3. O dot ficará verde quando conectado

**Para conectar via código:**
1. Selecione **Código de Pareamento**, informe o número e clique em **Gerar Código**
2. No WhatsApp: Dispositivos conectados → Vincular com número de telefone

A sessão fica salva em `auth_info/`. Ao desconectar, é apagada e será solicitada novamente.

---

## Esqueci a senha

Na tela de login, clique em **Esqueci a senha**. Se o WhatsApp estiver conectado, a senha será enviada para o número `OWNER_PHONE` após **3 minutos**.

---

## Estrutura de arquivos

```
├── server.js          # Servidor principal
├── .env               # Configurações (senha, telefone, porta)
├── config.json        # Configurações persistentes do painel
├── sessions.json      # Sessões de login ativas
├── package.json
├── auth_info/         # Sessão do WhatsApp (gerada automaticamente)
├── boletos/           # PDFs salvos por mês (gerada automaticamente)
└── README.md
```

---

## Tecnologias

- [Express](https://expressjs.com/) — servidor HTTP
- [pdf-parse](https://www.npmjs.com/package/pdf-parse) — extração de texto de PDF
- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web
- [qrcode](https://www.npmjs.com/package/qrcode) — geração do QR Code para o painel
- [axios](https://axios-http.com/) — download dos PDFs
- [dotenv](https://www.npmjs.com/package/dotenv) — variáveis de ambiente
- [Hostinger Node.js Web App](https://www.hostinger.com.br) — hospedagem gerenciada em produção
