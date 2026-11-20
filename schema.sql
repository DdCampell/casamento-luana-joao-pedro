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
  convidado_nome TEXT,
  mensagem TEXT,
  pagador_nome TEXT,
  pagador_email TEXT,
  mp_payment_id TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT
);

-- Se a tabela "pagamentos" já existia antes de 20/11/2026 (sem nome/mensagem
-- do convidado), rode também estas duas linhas no console do D1:
-- ALTER TABLE pagamentos ADD COLUMN convidado_nome TEXT;
-- ALTER TABLE pagamentos ADD COLUMN mensagem TEXT;

-- Guarda as tentativas erradas de login no painel admin, por IP, pra poder
-- bloquear quem ficar tentando adivinhar a senha (proteção contra força bruta).
CREATE TABLE IF NOT EXISTS tentativas_admin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
