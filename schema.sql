-- Rode isto uma vez no console do banco D1, antes de publicar o Worker.
-- (Cloudflare → Workers e Páginas → D1 → sua base → aba "Console", cole e execute.)

CREATE TABLE IF NOT EXISTS confirmacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  vai TEXT NOT NULL,
  pessoas INTEGER NOT NULL DEFAULT 1,
  mensagem TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referencia TEXT UNIQUE NOT NULL,
  itens TEXT NOT NULL,
  valor REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  pagador_nome TEXT,
  pagador_email TEXT,
  mp_payment_id TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT
);
