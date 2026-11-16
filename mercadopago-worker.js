/**
 * Servidorzinho (Cloudflare Worker) que gera um link de pagamento do Mercado Pago
 * já com o valor certo, a partir do carrinho do site de casamento.
 *
 * O QUE ISSO FAZ
 * O site (GitHub Pages) é uma página estática: qualquer pessoa pode ver o código-fonte
 * dela no navegador. Por isso, a chave secreta do Mercado Pago (Access Token) NUNCA pode
 * ficar dentro do index.html. Este arquivo roda num servidor separado, de graça, na
 * Cloudflare — ele guarda a chave em segredo e só devolve o link de pagamento pronto.
 *
 * COMO PUBLICAR (faça isso vocês mesmos, é rápido e gratuito):
 *
 * 1. Crie uma conta grátis em https://dash.cloudflare.com (se ainda não tiver).
 * 2. No menu lateral, vá em "Workers e Páginas" → "Criar aplicação" → "Criar Worker".
 * 3. Dê um nome, por exemplo: pagamento-luana-joao
 * 4. Depois de criado, clique em "Editar código" e apague tudo que estiver lá.
 * 5. Copie e cole o conteúdo deste arquivo inteiro no lugar.
 * 6. Clique em "Implantar" (Deploy).
 * 7. Vá em "Configurações" → "Variáveis e Secrets" do Worker e adicione uma variável
 *    secreta chamada exatamente: MP_ACCESS_TOKEN
 *    com o valor do Access Token de PRODUÇÃO da conta do Mercado Pago de vocês
 *    (pegue em: https://www.mercadopago.com.br/developers/panel — "Suas integrações"
 *    → a aplicação de vocês → "Credenciais de produção" → "Access Token").
 *    IMPORTANTE: cole o token só aqui, no painel da Cloudflare. Nunca no código,
 *    nunca no GitHub, nunca mandando para outra pessoa.
 * 8. Salve. A Cloudflare vai te dar uma URL parecida com:
 *    https://pagamento-luana-joao.SEUNOME.workers.dev
 * 9. Cole essa URL no site, no arquivo index.html, na linha:
 *      mpWorkerUrl: ""
 *    trocando por:
 *      mpWorkerUrl: "https://pagamento-luana-joao.SEUNOME.workers.dev"
 *
 * Pronto — o botão "Pagar com cartão" do site passa a abrir o checkout do Mercado Pago
 * já com o valor certinho; quem está pagando só escolhe o parcelamento e confirma.
 */

export default {
  async fetch(request, env) {
    // Libera o site a chamar este servidor (CORS)
    const headersCORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: headersCORS });
    }
    if (request.method !== 'POST') {
      return new Response('Método não permitido', { status: 405, headers: headersCORS });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ erro: 'JSON inválido' }), { status: 400, headers: headersCORS });
    }

    const itens = Array.isArray(body.items) ? body.items : [];
    if (itens.length === 0) {
      return new Response(JSON.stringify({ erro: 'Carrinho vazio' }), { status: 400, headers: headersCORS });
    }

    // Monta os itens no formato que o Mercado Pago espera
    const items = itens.map((it) => ({
      title: String(it.title || 'Presente de casamento').slice(0, 250),
      quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
      unit_price: Math.max(0.01, Number(it.unit_price) || 0),
      currency_id: 'BRL',
    }));

    const preference = {
      items,
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    });

    if (!resp.ok) {
      const detalhe = await resp.text();
      return new Response(JSON.stringify({ erro: 'Falha ao criar pagamento', detalhe }), {
        status: 502,
        headers: headersCORS,
      });
    }

    const data = await resp.json();
    return new Response(JSON.stringify({ url: data.init_point }), {
      headers: { ...headersCORS, 'Content-Type': 'application/json' },
    });
  },
};
