/**
 * Backend do site de casamento — roda num Cloudflare Worker (grátis).
 *
 * O que isso faz:
 * - POST /rsvp      → grava a confirmação de presença no banco.
 * - POST /checkout  → cria o pagamento no Mercado Pago com o valor certo
 *                     e grava uma linha "pendente" no banco.
 * - POST /webhook   → o Mercado Pago chama isso sozinho quando alguém paga;
 *                     atualiza a linha para "aprovado" (ou "recusado").
 * - POST /admin-api → confere usuário e senha; se estiver certo, devolve
 *                     as confirmações, os pagamentos e os totais em JSON.
 *                     Quem mostra a tela de login e o painel é a página
 *                     admin/index.html, hospedada no mesmo site do GitHub.
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
 *      - ADMIN_USUARIO   → o usuário para entrar no painel
 *      - ADMIN_SENHA     → a senha para entrar no painel
 *    Salve e implante de novo.
 * 8. Copie a URL do Worker (algo como https://casamento-backend.SEUNOME.workers.dev).
 * 9. No index.html do site, cole essa URL na linha `backendUrl: ""`.
 * 10. Abra admin/index.html (neste repositório) e cole a MESMA URL na linha
 *     `const BACKEND_URL = "";` do topo do arquivo.
 * 11. No painel do Mercado Pago (developers.mercadopago.com.br/panel) → sua
 *     aplicação → "Webhooks" → cadastre:
 *       https://casamento-backend.SEUNOME.workers.dev/webhook
 *     marcando o evento "Pagamentos".
 *
 * O painel fica no próprio site, em:
 *   https://ddcampell.github.io/casamento-luana-joao-pedro/admin/
 * Esse link não aparece em nenhum lugar do site — só quem tiver o
 * endereço exato (e o usuário/senha) consegue entrar.
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
      if (path === '/admin-api' && request.method === 'POST') return adminApi(request, env);
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
  const convidadoNome = String(body.nome || '').slice(0, 200);
  const mensagem = String(body.mensagem || '').slice(0, 1000);

  const preference = {
    items,
    external_reference: referencia,
    notification_url: urlBase + '/webhook',
    payer: convidadoNome ? { name: convidadoNome } : undefined,
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
    'INSERT INTO pagamentos (referencia, itens, valor, status, convidado_nome, mensagem) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(referencia, descricao, total, 'pendente', convidadoNome, mensagem).run();

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

/* ---------------- painel /admin-api: confere usuário/senha e devolve os dados ---------------- */
async function adminApi(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }

  const usuario = body.usuario || '';
  const senha = body.senha || '';
  if (usuario !== env.ADMIN_USUARIO || senha !== env.ADMIN_SENHA) {
    return json({ erro: 'Usuário ou senha incorretos.' }, 401);
  }

  const confirmacoes = await env.DB.prepare('SELECT * FROM confirmacoes ORDER BY id DESC').all();
  const pagamentos = await env.DB.prepare('SELECT * FROM pagamentos ORDER BY id DESC').all();

  const pessoasConfirmadas = confirmacoes.results
    .filter((c) => /sim/i.test(c.vai))
    .reduce((s, c) => s + (c.pessoas || 0), 0);
  const totalAprovado = pagamentos.results.filter((p) => p.status === 'aprovado').reduce((s, p) => s + p.valor, 0);
  const totalPendente = pagamentos.results.filter((p) => p.status === 'pendente').reduce((s, p) => s + p.valor, 0);

  return json({
    ok: true,
    resumo: { pessoasConfirmadas, totalAprovado, totalPendente },
    confirmacoes: confirmacoes.results,
    pagamentos: pagamentos.results,
  });
}
