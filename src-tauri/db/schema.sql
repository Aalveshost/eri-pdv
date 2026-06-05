-- PDV Salgados Pro - Database Schema
-- Refined with profit tracking, barcode support, and better reporting.

CREATE TABLE IF NOT EXISTS configuracoes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    dias_alerta_validade INTEGER DEFAULT 5,
    caminho_backup_externo TEXT,
    ultimo_backup_realizado DATETIME,
    nome_loja TEXT DEFAULT 'Salgados Pro',
    impressao_automatica INTEGER DEFAULT 0,
    impressao_vias INTEGER DEFAULT 1,
    impressao_corte INTEGER DEFAULT 0,
    impressao_largura_mm INTEGER DEFAULT 58
);

-- Insert default config if not exists
INSERT OR IGNORE INTO configuracoes (id, dias_alerta_validade, nome_loja) VALUES (1, 5, 'Salgados Pro');

CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    codigo_barras TEXT UNIQUE,
    preco_venda REAL NOT NULL,
    preco_custo REAL DEFAULT 0, -- Default cost price
    validade_padrao_dias INTEGER DEFAULT 3,
    ativo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL,
    data_fabricacao DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_validade DATE NOT NULL,
    qtd_inicial INTEGER NOT NULL,
    qtd_atual INTEGER NOT NULL,
    preco_custo REAL DEFAULT 0, -- Track profit margins
    status TEXT DEFAULT 'ativo', -- 'ativo', 'vencido', 'esgotado'
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_venda REAL NOT NULL,
    valor_desconto REAL DEFAULT 0,
    metodo_pagamento TEXT NOT NULL, -- 'dinheiro', 'pix', 'cartao'
    status TEXT DEFAULT 'completa', -- 'completa', 'cancelada'
    data_venda DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS venda_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL, -- Direct link for faster reporting
    lote_id INTEGER NOT NULL,
    quantidade INTEGER NOT NULL,
    preco_unitario REAL NOT NULL,
    preco_custo REAL NOT NULL, -- Snapshotted cost at time of sale
    FOREIGN KEY (venda_id) REFERENCES vendas(id),
    FOREIGN KEY (produto_id) REFERENCES produtos(id),
    FOREIGN KEY (lote_id) REFERENCES lotes(id)
);

CREATE TABLE IF NOT EXISTS venda_pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    metodo TEXT NOT NULL,
    valor REAL NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (venda_id) REFERENCES vendas(id)
);

-- Index for FIFO lookups
CREATE INDEX IF NOT EXISTS idx_lotes_validade ON lotes(produto_id, data_validade ASC) WHERE status = 'ativo' AND qtd_atual > 0;
CREATE INDEX IF NOT EXISTS idx_produtos_barras ON produtos(codigo_barras);
CREATE INDEX IF NOT EXISTS idx_venda_pagamentos_venda ON venda_pagamentos(venda_id, ordem);
CREATE INDEX IF NOT EXISTS idx_venda_pagamentos_metodo ON venda_pagamentos(metodo);
