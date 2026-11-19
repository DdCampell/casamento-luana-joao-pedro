# Backend do site (confirmações, pagamentos e painel /admin)

O site tem um backend próprio, rodando num Worker gratuito da Cloudflare, com
um banco de dados e um painel protegido por usuário e senha.

## O que ele guarda

- **Confirmações de presença** — nome, se vai, quantas pessoas, recado.
- **Pagamentos de presentes** — os itens escolhidos, o valor, e o status:
  `pendente` até o Mercado Pago confirmar o pagamento, depois muda sozinho
  para `aprovado` (com o nome e e-mail de quem pagou) ou `recusado`.

## Onde ver tudo

`https://ddcampell.github.io/casamento-luana-joao-pedro/admin/`

Esse link não aparece em nenhum lugar do site — só quem tiver o endereço
exato consegue chegar nele. É uma página comum do próprio site (fica no
GitHub Pages, junto com o resto), com uma tela de login pedindo usuário e
senha (os mesmos que você define no passo 6 abaixo). Depois de entrar,
mostra os totais e as duas listas completas.

Por trás dos panos, essa página (`admin/index.html`) não guarda nada —
ela só pergunta usuário/senha e manda para o Worker da Cloudflare
conferir. Quem guarda os dados e confere a senha é sempre o Worker,
nunca o GitHub Pages (que é só arquivo estático e não pode guardar
segredo nenhum).

## Como publicar — passo a passo

1. **Banco de dados**: Cloudflare → "Armazenamento e banco de dados" →
   "D1 SQL Database" → Criar. Nome sugerido: `casamento-db`.
2. Abra o banco → aba **Console** → cole o conteúdo de **schema.sql**
   (neste repositório) → execute. Isso cria as tabelas.
3. **Worker**: Cloudflare → "Workers e Páginas" → "Criar aplicação" →
   "Criar Worker". Nome sugerido: `casamento-backend`.
4. "Editar código" → apague tudo → cole o conteúdo de **worker.js** →
   "Implantar".
5. No Worker → "Configurações" → "Bindings" → adicionar vínculo tipo
   **D1 database**, nome da variável `DB`, apontando para `casamento-db`.
6. Ainda em "Configurações" → "Variáveis e Secrets" → adicionar como
   **Secret** (não como texto simples):
   - `MP_ACCESS_TOKEN` — o Access Token de produção do Mercado Pago
   - `ADMIN_USUARIO` — o usuário para entrar no painel
   - `ADMIN_SENHA` — a senha para entrar no painel
   Salvar e implantar de novo.
7. Copie a URL do Worker (ex.: `https://casamento-backend.seunome.workers.dev`)
   e cole em **dois lugares**:
   - no **index.html**, na linha `backendUrl: ""`;
   - no **admin/index.html**, na linha `const BACKEND_URL = "";`.
8. No painel do Mercado Pago (developers.mercadopago.com.br/panel) → sua
   aplicação → "Webhooks" → cadastre:
   `https://casamento-backend.seunome.workers.dev/webhook`
   marcando o evento "Pagamentos".

Enquanto o passo 7 não for feito, o site continua funcionando normalmente:
a confirmação de presença segue só pelo WhatsApp, o botão "Pagar com
cartão" avisa que ainda está sendo configurado (podendo usar o Pix), e o
painel mostra uma mensagem avisando que falta configurar o endereço do
backend.

## Por que isso não dá para fazer só no código do site

O site é uma página estática (GitHub Pages): o código é visível para
qualquer pessoa que o abrir no navegador. A chave do Mercado Pago e a
senha do painel nunca podem aparecer nesse código — por isso ficam só
no Worker, como *Secrets*, nunca no repositório do GitHub.
