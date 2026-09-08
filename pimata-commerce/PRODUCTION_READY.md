# PiMaTa Commerce — produção

Este backend está preparado para ser implantado sem substituir o `venda.pimata.app` atual durante a homologação.

## Arquitetura obrigatória

- 1 PostgreSQL dedicado ao Medusa;
- 1 Redis;
- 1 instância `pimata-server` com `MEDUSA_WORKER_MODE=server` e Admin habilitado;
- 1 instância `pimata-worker` com `MEDUSA_WORKER_MODE=worker` e Admin desabilitado;
- ambas as instâncias usam o mesmo `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` e `COOKIE_SECRET`.

O servidor expõe `/health`, `/pimata/status`, `/app` e o webhook de pagamento.

## Variáveis de produção

Obrigatórias no servidor e worker:

- `NODE_ENV=production`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `COOKIE_SECRET`
- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `MERCADO_PAGO_BACKEND_URL`
- `MERCADO_PAGO_STOREFRONT_URL=https://venda.pimata.app`
- `MELHOR_ENVIO_TOKEN`
- `MELHOR_ENVIO_ORIGIN_POSTAL_CODE`
- `MELHOR_ENVIO_SANDBOX=false`

Servidor:

- `MEDUSA_WORKER_MODE=server`
- `DISABLE_MEDUSA_ADMIN=false`
- `PORT=9000`

Worker:

- `MEDUSA_WORKER_MODE=worker`
- `DISABLE_MEDUSA_ADMIN=true`

## Mercado Pago

O webhook é:

`POST /hooks/payment/mercadopago_mercadopago`

A origem é validada pelo `x-signature` HMAC-SHA256 antes do provider Medusa receber a notificação. Em produção, o backend não inicia com Mercado Pago habilitado sem `MERCADO_PAGO_WEBHOOK_SECRET`.

O provider também consulta o pagamento diretamente na API do Mercado Pago antes de transformar a notificação em evento de pagamento Medusa; status, valor e referência recebidos no body não são tratados como fonte de verdade.

## Provisionamento Railway

O script `deploy-railway.ps1` cria a topologia servidor + worker + PostgreSQL + Redis em um projeto Railway novo, configura root directory `/pimata-commerce`, referências privadas de banco/cache, healthcheck `/health`, secrets aleatórios de JWT/cookie e executa o smoke test final.

Antes de executá-lo, mantenha estas variáveis somente no ambiente local/seguro:

```powershell
$env:MERCADO_PAGO_ACCESS_TOKEN="..."
$env:MERCADO_PAGO_WEBHOOK_SECRET="..."
$env:MELHOR_ENVIO_TOKEN="..."
$env:MELHOR_ENVIO_ORIGIN_POSTAL_CODE="SEU_CEP"

# opcionais, para importar os anúncios legados
$env:PIMATA_LEGACY_SUPABASE_URL="https://...supabase.co"
$env:PIMATA_LEGACY_SUPABASE_ANON_KEY="..."

./deploy-railway.ps1
```

O script exige uma sessão Railway autenticada. Ele não grava esses segredos no GitHub e não altera o DNS de `venda.pimata.app`.

## Smoke test

Depois de qualquer deploy do servidor:

```bash
npm run smoke:production -- https://SEU-BACKEND
```

O smoke test exige simultaneamente:

1. `/health` = `OK`;
2. `/pimata/status` identifica `pimata-commerce`;
3. PostgreSQL dedicado configurado;
4. Redis configurado;
5. modo `server`;
6. Mercado Pago configurado;
7. assinatura de webhook configurada;
8. Melhor Envio configurado;
9. webhook com assinatura deliberadamente inválida rejeitado com HTTP 401.

## Corte de domínio

Não apontar `venda.pimata.app` para o Medusa até completar, no ambiente implantado:

1. migrations;
2. bootstrap Brasil/BRL;
3. endereço real do estoque;
4. importação dos anúncios ativos;
5. criação do usuário administrador;
6. teste de frete real;
7. pagamento de homologação e webhook assinado;
8. cancelamento/reembolso de homologação;
9. storefront conectada ao Store API;
10. smoke test verde.

Até lá, a loja atual permanece em produção sem alteração.
