/**
 * BACKEND do site de casamento — roda dentro da própria Planilha Google.
 *
 * O que isso faz:
 * - Recebe as confirmações de presença do site e escreve na aba "Confirmações".
 * - Quando alguém clica em "Pagar com cartão", cria o pagamento no Mercado Pago
 *   (já com o valor certo) e grava uma linha "pendente" na aba "Presentes".
 * - Quando o Mercado Pago avisa que alguém pagou de verdade, atualiza essa linha
 *   para "aprovado", com o nome de quem pagou e o valor.
 *
 * Assim o casal só precisa abrir a planilha para ver tudo: quem confirmou,
 * quantas pessoas, e quem já pagou presente e quanto.
 *
 * ============================================================
 * COMO PUBLICAR (uma única vez, direto na planilha)
 * ============================================================
 * 1. Abra a planilha "Casamento Luana & João Pedro — Confirmações e Presentes".
 * 2. No menu, vá em Extensões → Apps Script.
 * 3. Apague o conteúdo que já estiver lá (geralmente um "function myFunction(){}")
 *    e cole todo o conteúdo deste arquivo no lugar.
 * 4. No menu lateral esquerdo do editor, clique no ícone de engrenagem
 *    ("Configurações do projeto") e marque "Mostrar arquivo manifesto appsscript.json".
 * 5. Ainda no editor, clique no ícone de relógio/chave ("Propriedades do script" —
 *    em Configurações do projeto, role até "Propriedades do script") e adicione:
 *      Propriedade: MP_ACCESS_TOKEN   Valor: <o Access Token de produção do Mercado Pago>
 *    (esse token é o mesmo que seria usado no servidor Cloudflare — aqui ele fica
 *    guardado em segredo dentro da própria conta Google, ninguém mais vê.)
 * 6. Clique em "Implantar" → "Nova implantação".
 *    - Tipo: "App da Web"
 *    - Executar como: "Eu" (sua conta)
 *    - Quem pode acessar: "Qualquer pessoa"
 *    - Clique em "Implantar" e autorize o acesso quando pedir.
 * 7. Copie a "URL do app da Web" que aparece (termina com /exec).
 * 8. Cole essa URL no arquivo index.html do site, na linha:
 *      backendUrl: ""
 *    trocando por:
 *      backendUrl: "https://script.google.com/macros/s/XXXXXXX/exec"
 * 9. No painel do Mercado Pago (developers.mercadopago.com.br/panel), na aplicação
 *    criada, em "Webhooks", cadastre a mesma URL acima como URL de notificação,
 *    marcando o evento "Pagamentos".
 *
 * Pronto — toda confirmação e todo pagamento passam a aparecer na planilha.
 */

const ABA_CONFIRMACOES = 'Confirmações';
const ABA_PRESENTES = 'Presentes';

function doPost(e) {
  try {
    const corpo = JSON.parse(e.postData.contents);
    const acao = corpo.action;

    if (acao === 'rsvp') return responder(salvarConfirmacao(corpo));
    if (acao === 'checkout') return responder(criarPagamento(corpo));
    if (corpo.type === 'payment' || (corpo.data && corpo.data.id)) return responder(receberWebhook(corpo));

    return responder({ erro: 'Ação não reconhecida' });
  } catch (err) {
    return responder({ erro: String(err) });
  }
}

/* também aceita o webhook do Mercado Pago chegando por GET com query string */
function doGet(e) {
  if (e.parameter && e.parameter['data.id']) {
    receberWebhook({ data: { id: e.parameter['data.id'] } });
  }
  return ContentService.createTextOutput('ok');
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function planilha() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/* ---------- confirmação de presença ---------- */
function salvarConfirmacao(corpo) {
  const aba = planilha().getSheetByName(ABA_CONFIRMACOES);
  aba.appendRow([
    new Date(),
    corpo.nome || '',
    corpo.vai || '',
    corpo.pessoas || 1,
    corpo.mensagem || '',
  ]);
  return { ok: true };
}

/* ---------- criar pagamento (Mercado Pago) ---------- */
function criarPagamento(corpo) {
  const token = PropertiesService.getScriptProperties().getProperty('MP_ACCESS_TOKEN');
  if (!token) return { erro: 'MP_ACCESS_TOKEN não configurado nas Propriedades do script' };

  const itens = (corpo.items || []).map((it) => ({
    title: String(it.title || 'Presente de casamento').slice(0, 250),
    quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
    unit_price: Math.max(0.01, Number(it.unit_price) || 0),
    currency_id: 'BRL',
  }));
  if (itens.length === 0) return { erro: 'Carrinho vazio' };

  const referencia = Utilities.getUuid();
  const total = itens.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const descricao = itens.map((i) => `${i.quantity}x ${i.title}`).join(', ');

  const urlApp = ScriptApp.getService().getUrl();
  const preferencia = {
    items: itens,
    external_reference: referencia,
    notification_url: urlApp,
    back_urls: {
      success: corpo.success_url || 'https://ddcampell.github.io/casamento-luana-joao-pedro/#presentes',
      pending: corpo.success_url || 'https://ddcampell.github.io/casamento-luana-joao-pedro/#presentes',
      failure: corpo.failure_url || 'https://ddcampell.github.io/casamento-luana-joao-pedro/#presentes',
    },
    auto_return: 'approved',
    statement_descriptor: 'PRESENTE CASAMENTO',
  };

  const resp = UrlFetchApp.fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(preferencia),
    muteHttpExceptions: true,
  });

  const dados = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() >= 300) return { erro: 'Falha no Mercado Pago', detalhe: dados };

  planilha().getSheetByName(ABA_PRESENTES).appendRow([
    new Date(), referencia, descricao, total, 'pendente', '', '',
  ]);

  return { url: dados.init_point };
}

/* ---------- webhook: Mercado Pago avisando que algo mudou ---------- */
function receberWebhook(corpo) {
  const token = PropertiesService.getScriptProperties().getProperty('MP_ACCESS_TOKEN');
  const paymentId = corpo.data && corpo.data.id;
  if (!token || !paymentId) return { ok: true };

  const resp = UrlFetchApp.fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) return { ok: true };

  const pagamento = JSON.parse(resp.getContentText());
  const referencia = pagamento.external_reference;
  if (!referencia) return { ok: true };

  const aba = planilha().getSheetByName(ABA_PRESENTES);
  const dados = aba.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][1] === referencia) {
      const linha = i + 1;
      const status = pagamento.status === 'approved' ? 'aprovado'
        : pagamento.status === 'rejected' ? 'recusado' : pagamento.status;
      aba.getRange(linha, 5).setValue(status); // Status
      aba.getRange(linha, 6).setValue(
        (pagamento.payer && (pagamento.payer.first_name || pagamento.payer.email)) || ''
      ); // Pagador
      aba.getRange(linha, 7).setValue(String(paymentId)); // ID Mercado Pago
      break;
    }
  }
  return { ok: true };
}
