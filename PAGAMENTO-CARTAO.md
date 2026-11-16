# Pagamento com cartão (valor já preenchido)

O site já tem um carrinho na seção "Lista de presentes": a pessoa escolhe quantas
cotas quiser de cada presente, vê o total somado e aperta "Pagar com cartão".

Para esse botão realmente abrir o Mercado Pago com o valor certo, falta publicar
um servidorzinho gratuito que guarda a chave secreta da conta de vocês. Enquanto
isso não for feito, o botão avisa a pessoa para usar o Pix.

## Passo a passo

1. Abra o arquivo **mercadopago-worker.js**, que está neste mesmo repositório.
   As instruções de como publicá-lo (gratuitamente, na Cloudflare) estão escritas
   em comentário no topo do próprio arquivo.
2. Depois de publicado, você vai ter uma URL parecida com:
   `https://pagamento-luana-joao.seunome.workers.dev`
3. Abra o arquivo **index.html**, procure por `mpWorkerUrl: ""` (fica perto do
   início do bloco `const CASAMENTO = {`) e cole a URL ali dentro das aspas.
4. Suba a alteração para o GitHub (ou me mande a URL que eu faço essa parte).

## Por que não dá para fazer isso só no site, sem o servidor

O site é uma página estática (GitHub Pages): o código-fonte fica visível para
qualquer pessoa que abrir o site. A chave secreta do Mercado Pago (o "Access
Token") dá acesso à conta de recebimento de vocês — ela nunca pode aparecer
nesse código. Por isso ela mora só no servidorzinho (Cloudflare Worker), que
é privado, e nunca no repositório do GitHub.

## Editando os presentes e valores

No arquivo **index.html**, procure por `const PRESENTES = [` — é uma lista
simples, com nome, emoji e valor de cada cota. É só editar ali.
