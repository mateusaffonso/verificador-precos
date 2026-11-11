# Verificador de Preços — Black Friday

Monitora o preço dos produtos que você escolher, busca o **mesmo modelo** em várias lojas, acompanha cupons e promoções e manda um **e-mail resumo** quando algo interessante acontece. Roda de graça com **GitHub Actions** (verificação a cada 5 min) e **GitHub Pages** (painel).

**Lojas:** Amazon, Mercado Livre, Magalu, Casas Bahia, KaBuM!, Terabyte, Pichau, Shopee, AliExpress e o comparador **Zoom** (que agrega ofertas de dezenas de lojas).
**Cupons:** cupom exibido na página do produto, cupons da Cuponomia e do Promobit (só das lojas onde você tem ofertas) e promoções postadas no Promobit/Pelando.

## Como funciona

```
GitHub Pages (docs/)  ──lê──►  branch "data" (products.json, state.json, history/)
      │  salva products.json (API, com seu token)        ▲
      └─ "Verificar agora" ─► GitHub Actions (cron 5 min) ┘  grava preços e envia e-mail
```

- A cada **5 min**: rechecagem das ofertas já conhecidas e das promoções no Promobit.
- A cada **30 min** (ou ao adicionar um produto / clicar em "Buscar de novo"): **busca ampla** em todas as lojas, cupons das lojas e Pelando.
- **Correspondência exata:** usa EAN, código do fabricante, números do modelo, capacidade (128GB…), cor e palavras de versão (Pro, Plus, Ti, Slim…). Rejeita acessórios, usados e outras marcas.
- **Ofertas confiáveis entram sozinhas**; as duvidosas (kit com acessório, vendedor não identificado em marketplace) ficam em "para revisar" no painel.
- **Só produto novo e lojas oficiais/confiáveis**: vendido pela própria loja (Amazon, Magalu, Casas Bahia, KaBuM!), Loja Oficial/MercadoLíder no ML, Shopee Mall, AliExpress Choice ou loja oficial da marca.
- **Alertas por produto:** preço-alvo, menor preço já visto, queda ≥ X% e qualquer queda. No máximo **1 e-mail por verificação**, agrupando tudo.

## Configuração (uma vez)

1. **Segredos do e-mail** — em *Settings → Secrets and variables → Actions → New repository secret*:
   - `GMAIL_USER`: seu endereço do Gmail.
   - `GMAIL_APP_PASSWORD`: uma **senha de app** do Google (exige verificação em duas etapas): <https://myaccount.google.com/apppasswords>.
   - (opcional) `ALERT_TO`: outro destinatário. Se omitido, o alerta vai para o próprio `GMAIL_USER`.
2. **Token para o painel** — crie um token *fine-grained* em <https://github.com/settings/personal-access-tokens/new> com acesso **só a este repositório** e as permissões **Contents: Read and write** e **Actions: Read and write**. Cole no painel (ícone de engrenagem). Ele fica salvo apenas no seu navegador.
3. Abra o painel, cole o link de um produto (ou digite o nome), defina o preço-alvo e as regras. A primeira busca leva de 1 a 3 minutos.

## Limitações conhecidas

- **Bloqueios anti-robô:** Mercado Livre, Magalu, Casas Bahia, Terabyte, Pichau, Shopee (exige login) e Pelando bloqueiam servidores de nuvem. O app tenta um Chrome headless e, quando ainda assim falha, marca "bloqueado". Os preços dessas lojas continuam chegando **pelo Zoom**, que lista ofertas delas. A aba *Lojas* mostra o que está acessível.
- **Atrasos do agendamento:** o GitHub pode atrasar execuções agendadas em horários de pico (às vezes 10–20 min). "Verificar agora" dispara na hora.
- **Frete não é considerado.** Cupons de primeira compra ou de app aparecem como informação, sem descontar do preço.
- Repositórios públicos têm o agendamento desativado após 60 dias sem atividade; os commits automáticos de dados contam como atividade.
- Confira sempre na loja antes de comprar: preços e estoques mudam rápido na Black Friday.

## Rodar localmente

```bash
npm install
mkdir -p data && echo '[{"id":"p1","name":"Apple iPhone 15 128GB Preto","targetPrice":3700}]' > data/products.json
DRY_RUN=1 node src/run.js          # não envia e-mail
npm test                           # testes do matching
```

Variáveis úteis: `FORCE_DISCOVERY=1`, `DISCOVERY_MINUTES=30`, `BROWSER_BUDGET=14`, `PW_EXECUTABLE_PATH=/caminho/do/chrome`, `MAX_RUN_SECONDS=260`.
