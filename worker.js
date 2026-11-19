/**
 * Backend do site de casamento — roda num Cloudflare Worker (grátis).
 *
 * O que isso faz:
 * - POST /rsvp      → grava a confirmação de presença no banco.
 * - POST /checkout  → cria o pagamento no Mercado Pago com o valor certo
 *                     e grava uma linha "pendente" no banco.
 * - POST /webhook   → o Mercado Pago chama isso sozinho quando alguém paga;
 *                     atualiza a linha para "aprovado" (ou "recusado").
 * - GET  /admin      → tela de login (usuário e senha). Depois de entrar,
 *                     mostra as confirmações de presença e os pagamentos,
 *                     com os totais.
 *
 * ============================================================
 * COMO PUBLICAR (direto pelo site da Cloudflare, sem instalar nada)
 * ============================================================
 * 1. Crie uma conta grátis em https://dash.cloudflare.com
 * 2. Menu lateral → "Armazenamento e banco de dados" → "D1 SQL Database"
 *    → "Criar". Dê um nome, por exemplo: casamento-db
 * 3. Abra o banco criado → aba "Console" → cole o conteúdo do arquivo
 *    schema.sql (deste repositório) → execute. Isso cria as duas tabelas.
 * 4. Menu lateral → "Workers e Páginas" → "Criar aplicação" → "Criar Worker".
 *    Dê um nome, por exemplo: casamento-backend
 * 5. Clique em "Editar código", apague tudo e cole o conteúdo deste arquivo.
 *    Clique em "Implantar".
 * 6. No Worker criado → "Configurações" → "Bindings" (vínculos) → adicione:
 *      - "D1 database": nome da variável = DB  → escolha o banco casamento-db
 * 7. Ainda em "Configurações" → "Variáveis e Secrets", adicione como *Secret*:
 *      - MP_ACCESS_TOKEN → o Access Token de produção do Mercado Pago
 *      - ADMIN_USUARIO   → o usuário que vocês vão digitar para entrar no /admin
 *      - ADMIN_SENHA     → a senha de vocês para entrar no /admin
 *    Salve e implante de novo.
 * 8. Copie a URL do Worker (algo como https://casamento-backend.SEUNOME.workers.dev).
 * 9. No index.html do site, cole essa URL na linha `backendUrl: ""`.
 * 10. No painel do Mercado Pago (developers.mercadopago.com.br/panel) → sua
 *     aplicação → "Webhooks" → cadastre:
 *       https://casamento-backend.SEUNOME.workers.dev/webhook
 *     marcando o evento "Pagamentos".
 *
 * O painel fica em:
 *   https://casamento-backend.SEUNOME.workers.dev/admin
 * Esse endereço não aparece em nenhum lugar do site — só quem tiver o link
 * (e o usuário/senha) consegue entrar.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (path === '/rsvp' && request.method === 'POST') return rsvp(request, env);
      if (path === '/checkout' && request.method === 'POST') return checkout(request, env);
      if (path === '/webhook' && (request.method === 'POST' || request.method === 'GET')) return webhook(request, env, url);
      if (path === '/admin') return admin(request, env);
      if (path === '/admin-sair') return new Response(null,{status:303,headers:{Location:'/admin','Set-Cookie':`${COOKIE_NOME}=; Path=/admin; Max-Age=0`}});
      return new Response('Não encontrado', { status: 404 });
    } catch (e) {
      return new Response(JSON.stringify({ erro: String(e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  },
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* ---------------- confirmação de presença ---------------- */
async function rsvp(request, env) {
  const body = await request.json();
  await env.DB.prepare(
    'INSERT INTO confirmacoes (nome, vai, pessoas, mensagem) VALUES (?, ?, ?, ?)'
  ).bind(body.nome || '', body.vai || '', parseInt(body.pessoas, 10) || 1, body.mensagem || '').run();
  return json({ ok: true });
}

/* ---------------- criar pagamento (Mercado Pago) ---------------- */
async function checkout(request, env) {
  const body = await request.json();
  const itensEntrada = Array.isArray(body.items) ? body.items : [];
  if (itensEntrada.length === 0) return json({ erro: 'Carrinho vazio' }, 400);

  const items = itensEntrada.map((it) => ({
    title: String(it.title || 'Presente de casamento').slice(0, 250),
    quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
    unit_price: Math.max(0.01, Number(it.unit_price) || 0),
    currency_id: 'BRL',
  }));

  const referencia = crypto.randomUUID();
  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const descricao = items.map((i) => `${i.quantity}x ${i.title}`).join(', ');
  const urlBase = new URL(request.url).origin;

  const preference = {
    items,
    external_reference: referencia,
    notification_url: urlBase + '/webhook',
    back_urls: {
      success: body.success_url || 'https://ddcampell.github.io/casamento-luana-joao-pedro/#presentes',
      pending: body.success_url || 'https://ddcampell.github.io/casamento-luana-joao-pedro/#presentes',
      failure: body.failure_url || 'https://ddcampell.github.io/casamento-luana-joao-pedro/#presentes',
    },
    auto_return: 'approved',
    statement_descriptor: 'PRESENTE CASAMENTO',
  };

  const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
    body: JSON.stringify(preference),
  });
  if (!resp.ok) return json({ erro: 'Falha ao criar pagamento', detalhe: await resp.text() }, 502);
  const data = await resp.json();

  await env.DB.prepare(
    'INSERT INTO pagamentos (referencia, itens, valor, status) VALUES (?, ?, ?, ?)'
  ).bind(referencia, descricao, total, 'pendente').run();

  return json({ url: data.init_point });
}

/* ---------------- webhook: Mercado Pago avisando pagamento ---------------- */
async function webhook(request, env, url) {
  let paymentId = url.searchParams.get('data.id') || url.searchParams.get('id');
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      paymentId = (body.data && body.data.id) || paymentId;
    } catch {}
  }
  if (!paymentId) return json({ ok: true });

  const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });
  if (!resp.ok) return json({ ok: true });
  const pagamento = await resp.json();
  const referencia = pagamento.external_reference;
  if (!referencia) return json({ ok: true });

  const status = pagamento.status === 'approved' ? 'aprovado' : pagamento.status === 'rejected' ? 'recusado' : pagamento.status;
  const nome = (pagamento.payer && (pagamento.payer.first_name || '')) || '';
  const email = (pagamento.payer && pagamento.payer.email) || '';

  await env.DB.prepare(
    `UPDATE pagamentos SET status=?, pagador_nome=?, pagador_email=?, mp_payment_id=?, atualizado_em=datetime('now') WHERE referencia=?`
  ).bind(status, nome, email, String(paymentId), referencia).run();

  return json({ ok: true });
}

/* ---------------- painel /admin: login + dashboard ---------------- */
const COOKIE_NOME = 'sessao_admin';
const SESSAO_HORAS = 12;

async function assinar(valor, chave) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(valor));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sessaoValida(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const m = cookieHeader.match(new RegExp(COOKIE_NOME + '=([^;]+)'));
  if (!m) return false;
  const [payloadB64, assinatura] = decodeURIComponent(m[1]).split('.');
  if (!payloadB64 || !assinatura) return false;
  const esperado = await assinar(payloadB64, env.ADMIN_SENHA || '');
  if (esperado !== assinatura) return false;
  try {
    const payload = JSON.parse(atob(payloadB64));
    return payload.exp > Date.now();
  } catch { return false; }
}

async function criarCookie(env) {
  const payload = { exp: Date.now() + SESSAO_HORAS * 3600 * 1000 };
  const payloadB64 = btoa(JSON.stringify(payload));
  const assinatura = await assinar(payloadB64, env.ADMIN_SENHA || '');
  const valor = encodeURIComponent(payloadB64 + '.' + assinatura);
  return `${COOKIE_NOME}=${valor}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${SESSAO_HORAS * 3600}`;
}

function paginaLogin(erro) {
  return htmlPage(`
    <div class="caixa-login">
      <h1>Painel do casamento</h1>
      ${erro ? `<p class="erro">${erro}</p>` : ''}
      <form method="POST" action="/admin">
        <label>Usuário<input type="text" name="usuario" autofocus required></label>
        <label>Senha<input type="password" name="senha" required></label>
        <button type="submit">Entrar</button>
      </form>
    </div>`);
}

function htmlPage(corpo) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Painel do casamento</title>
  <style>
    *{box-sizing:border-box} body{font-family:system-ui,Arial,sans-serif;background:#f4f3ee;color:#1f3a2b;margin:0;padding:24px}
    h1{font-size:28px;margin:0 0 20px}
    h2{font-size:20px;margin:36px 0 10px;color:#1f3a2b}
    .caixa-login{max-width:380px;margin:80px auto;background:#fff;padding:36px;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.08)}
    label{display:block;margin-bottom:16px;font-size:15px}
    input{width:100%;padding:12px;font-size:16px;margin-top:6px;border:1px solid #bfc9bb;border-radius:4px}
    button{width:100%;padding:13px;font-size:16px;background:#5f7d68;color:#fff;border:0;border-radius:4px;cursor:pointer;margin-top:6px}
    .erro{color:#a33;margin-bottom:14px}
    .resumo{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px}
    .cartao{background:#fff;border-radius:8px;padding:18px 22px;min-width:180px;box-shadow:0 4px 14px rgba(0,0,0,.06)}
    .cartao strong{display:block;font-size:26px;margin-top:4px}
    table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:10px;font-size:14px}
    th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #eee}
    th{background:#ebede6}
    .status-aprovado{color:#2a6b3f;font-weight:600}
    .status-pendente{color:#9a7b1f;font-weight:600}
    .status-recusado{color:#a33;font-weight:600}
    .topo{display:flex;justify-content:space-between;align-items:center}
    a.sair{color:#5f7d68;text-decoration:none;font-size:14px}
    .vazio{color:#777;padding:14px}
  </style></head><body>${corpo}</body></html>`;
}

async function admin(request, env) {
  if (request.method === 'POST') {
    const form = await request.formData();
    const usuario = form.get('usuario') || '';
    const senha = form.get('senha') || '';
    if (usuario === env.ADMIN_USUARIO && senha === env.ADMIN_SENHA) {
      return new Response(null, { status: 303, headers: { Location: '/admin', 'Set-Cookie': await criarCookie(env) } });
    }
    return new Response(paginaLogin('Usuário ou senha incorretos.'), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  if (!(await sessaoValida(request, env))) {
    return new Response(paginaLogin(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const confirmacoes = await env.DB.prepare('SELECT * FROM confirmacoes ORDER BY id DESC').all();
  const pagamentos = await env.DB.prepare('SELECT * FROM pagamentos ORDER BY id DESC').all();

  const pessoasConfirmadas = confirmacoes.results
    .filter((c) => /sim/i.test(c.vai))
    .reduce((s, c) => s + (c.pessoas || 0), 0);
  const totalAprovado = pagamentos.results.filter((p) => p.status === 'aprovado').reduce((s, p) => s + p.valor, 0);
  const totalPendente = pagamentos.results.filter((p) => p.status === 'pendente').reduce((s, p) => s + p.valor, 0);
  const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  const linhasConfirmacoes = confirmacoes.results.length
    ? confirmacoes.results.map((c) => `<tr>
        <td>${escapeHtml(c.criado_em)}</td><td>${escapeHtml(c.nome)}</td>
        <td>${escapeHtml(c.vai)}</td><td>${c.pessoas}</td><td>${escapeHtml(c.mensagem || '')}</td>
      </tr>`).join('')
    : `<tr><td colspan="5" class="vazio">Nenhuma confirmação ainda.</td></tr>`;

  const linhasPagamentos = pagamentos.results.length
    ? pagamentos.results.map((p) => `<tr>
        <td>${escapeHtml(p.criado_em)}</td><td>${escapeHtml(p.itens)}</td><td>${brl(p.valor)}</td>
        <td class="status-${p.status}">${escapeHtml(p.status)}</td>
        <td>${escapeHtml(p.pagador_nome || '')}</td><td>${escapeHtml(p.pagador_email || '')}</td>
      </tr>`).join('')
    : `<tr><td colspan="6" class="vazio">Nenhum pagamento ainda.</td></tr>`;

  return new Response(htmlPage(`
    <div class="topo"><h1>Painel do casamento</h1><a class="sair" href="/admin-sair">Sair</a></div>
    <div class="resumo">
      <div class="cartao">Pessoas confirmadas<strong>${pessoasConfirmadas}</strong></div>
      <div class="cartao">Já recebido<strong>${brl(totalAprovado)}</strong></div>
      <div class="cartao">Pendente<strong>${brl(totalPendente)}</strong></div>
    </div>

    <h2>Confirmações de presença</h2>
    <table><thead><tr><th>Data</th><th>Nome</th><th>Vai?</th><th>Pessoas</th><th>Recado</th></tr></thead>
      <tbody>${linhasConfirmacoes}</tbody></table>

    <h2>Pagamentos de presentes</h2>
    <table><thead><tr><th>Data</th><th>Itens</th><th>Valor</th><th>Status</th><th>Pagador</th><th>E-mail</th></tr></thead>
      <tbody>${linhasPagamentos}</tbody></table>
  `), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
