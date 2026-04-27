import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";

const SCHEMA = `
-- PDV Salgados Pro - Database Schema
CREATE TABLE IF NOT EXISTS configuracoes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    dias_alerta_validade INTEGER DEFAULT 5,
    caminho_backup_externo TEXT,
    ultimo_backup_realizado DATETIME,
    nome_loja TEXT DEFAULT 'Salgados Pro',
    frequencia_backup_dias INTEGER DEFAULT 7,
    senha TEXT DEFAULT '1234'
);

INSERT OR IGNORE INTO configuracoes (id, dias_alerta_validade, nome_loja) VALUES (1, 5, 'Salgados Pro');

CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    codigo_barras TEXT UNIQUE,
    preco_venda REAL NOT NULL,
    preco_custo REAL DEFAULT 0,
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
    preco_custo REAL DEFAULT 0,
    status TEXT DEFAULT 'ativo',
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_venda REAL NOT NULL,
    valor_desconto REAL DEFAULT 0,
    metodo_pagamento TEXT NOT NULL,
    status TEXT DEFAULT 'completa',
    data_venda DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS venda_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    lote_id INTEGER,
    quantidade INTEGER NOT NULL,
    preco_unitario REAL NOT NULL,
    preco_custo REAL NOT NULL,
    FOREIGN KEY (venda_id) REFERENCES vendas(id),
    FOREIGN KEY (produto_id) REFERENCES produtos(id),
    FOREIGN KEY (lote_id) REFERENCES lotes(id)
);

CREATE INDEX IF NOT EXISTS idx_lotes_validade ON lotes(produto_id, data_validade ASC) WHERE status = 'ativo' AND qtd_atual > 0;
CREATE INDEX IF NOT EXISTS idx_produtos_barras ON produtos(codigo_barras);

CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    telefone TEXT,
    observacao TEXT,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendas_prazo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL,
    data_venda TEXT NOT NULL,
    total REAL NOT NULL,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS vendas_prazo_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    produto_nome TEXT NOT NULL,
    quantidade INTEGER NOT NULL,
    valor_total REAL NOT NULL,
    FOREIGN KEY (venda_id) REFERENCES vendas_prazo(id)
);

CREATE TABLE IF NOT EXISTS pagamentos_prazo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL,
    data_pagamento TEXT NOT NULL,
    valor REAL NOT NULL,
    observacao TEXT,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS contas_arquivadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL,
    cliente_nome TEXT NOT NULL,
    cliente_telefone TEXT,
    data_arquivo TEXT NOT NULL,
    total_compras REAL NOT NULL,
    total_pago REAL NOT NULL,
    itens_json TEXT,
    pagamentos_json TEXT,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE INDEX IF NOT EXISTS idx_vendas_prazo_cliente ON vendas_prazo(cliente_id, data_venda);
CREATE INDEX IF NOT EXISTS idx_pagamentos_cliente ON pagamentos_prazo(cliente_id, data_pagamento);
`;

let dbInstance: Database | null = null;
let initPromise: Promise<Database> | null = null;

export function useDatabase() {
  const [db, setDb] = useState<Database | null>(dbInstance);
  const [loading, setLoading] = useState(!dbInstance);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dbInstance) {
      setDb(dbInstance);
      setLoading(false);
      return;
    }

    async function init() {
      try {
        if (initPromise) {
          const _db = await initPromise;
          setDb(_db);
          setLoading(false);
          return;
        }

        console.log("useDatabase: Plugin Database carregado?", !!Database);
        initPromise = (async () => {
          console.log("useDatabase: Chamando Database.load...");
          const _db = await Database.load("sqlite:salgados.db");
          
          // 1. Migrations FIRST to ensure columns exist
          const migrations = [
            "ALTER TABLE produtos ADD COLUMN preco_custo REAL DEFAULT 0",
            "ALTER TABLE configuracoes ADD COLUMN frequencia_backup_dias INTEGER DEFAULT 7",
            "ALTER TABLE contas_arquivadas ADD COLUMN cliente_telefone TEXT",
            "ALTER TABLE contas_arquivadas ADD COLUMN itens_json TEXT",
            "ALTER TABLE contas_arquivadas ADD COLUMN pagamentos_json TEXT",
            "ALTER TABLE contas_arquivadas ADD COLUMN codigo_arquivamento TEXT",
            "ALTER TABLE lotes ADD COLUMN qtd_vendida INTEGER DEFAULT 0",
            "ALTER TABLE lotes ADD COLUMN produto_avulso_nome TEXT",
            "ALTER TABLE configuracoes ADD COLUMN senha TEXT DEFAULT '1234'",
            "ALTER TABLE venda_itens ADD COLUMN preco_custo REAL DEFAULT 0"
          ];

          for (const m of migrations) {
            try { await _db.execute(m); } catch (e) { /* ignore if already exists */ }
          }

          // 2. Then execute main schema
          const statements = SCHEMA.split(';').filter(s => s.trim().length > 0);
          for (const s of statements) {
            await _db.execute(s);
          }
          
          dbInstance = _db;
          return _db;
        })();

        const finalizedDb = await initPromise;
        setDb(finalizedDb);
      } catch (err: any) {
        const msg = String(err?.message || err);
        console.error("useDatabase: Erro crítico no init:", msg);
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  return { db, loading, error };
}
