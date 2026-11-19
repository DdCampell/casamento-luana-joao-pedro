# Backend do site (confirmações + pagamentos)

O site grava tudo numa Planilha Google, que funciona como o "painel" do casal:

**Planilha:** https://docs.google.com/spreadsheets/d/1iCvuxSq6rqOLL2-XgoUh-X3ZzA4B9AJ3_K6EtNmeItE/edit

Ela tem 3 abas:
- **Resumo** — total de pessoas confirmadas e total já recebido/pendente em presentes.
- **Confirmações** — cada resposta do formulário "Confirme sua presença": nome, se vai,
  quantas pessoas, recado.
- **Presentes** — cada vez que alguém clica em "Pagar com cartão": os itens, o valor,
  e o status (`pendente` até o pagamento ser aprovado, depois muda sozinho para
  `aprovado` ou `recusado`, com o nome de quem pagou).

## Como ativar

1. Abra a planilha acima e vá em **Extensões → Apps Script**.
2. Cole o conteúdo do arquivo **apps-script.gs** (deste repositório) lá dentro.
   As instruções completas — incluindo onde colar o Access Token do Mercado Pago
   e como publicar — estão escritas em comentário no topo do próprio arquivo.
3. Depois de publicar, você recebe uma URL terminando em `/exec`.
4. Cole essa URL no **index.html**, na linha `backendUrl: ""`.
5. Cadastre a mesma URL como webhook no painel do Mercado Pago (também explicado
   no topo do apps-script.gs).

Enquanto o passo 4 não for feito, o site continua funcionando normalmente:
- a confirmação de presença some só pelo WhatsApp, como já era antes;
- o botão "Pagar com cartão" avisa que ainda está sendo configurado, e a
  pessoa pode usar o Pix normalmente.

## Por que não dá para fazer isso só com o código do site

O site é uma página estática (GitHub Pages): o código-fonte é visível para
qualquer pessoa que abrir o site no navegador. A chave secreta do Mercado Pago
e a escrita na planilha dependem de permissões que não podem ficar expostas
nesse código — por isso ficam guardadas no Apps Script, que roda de forma
privada dentro da conta Google.
