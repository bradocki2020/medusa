# PiMaTa Commerce — Medusa

Backend de comércio da PiMaTa preparado sobre Medusa 2.20.1.

## Objetivo

Migrar gradualmente o `https://venda.pimata.app` para uma plataforma de e-commerce completa sem derrubar ou substituir a loja atual antes da validação.

A produção atual permanece intacta. Este backend vive isolado em `pimata-commerce/` e na branch `pimata-commerce`.

## Venda Única

O fluxo `src/workflows/create-venda-unica.ts` cria uma peça com:

- status `published`;
- preço em BRL usando unidades monetárias principais do Medusa v2;
- uma variante `Peça única`;
- `manage_inventory: true`;
- `allow_backorder: false`;
- estoque inicial exatamente `1` no local padrão da loja;
- metadata `pimata_sale_type=venda_unica` e `pimata_single_stock=true`;
- `pimata_source_id`, condição e preço anterior quando fornecidos.

O endpoint administrativo é:

`POST /admin/pimata/venda-unica`

Por estar sob `/admin`, ele exige autenticação administrativa do Medusa.

Exemplo de corpo:

```json
{
  "title": "Cabelo Humano 65cm 100g",
  "description": "Peça única",
  "price": 399.9,
  "compare_at_price": 479.9,
  "sku": "VU-EXEMPLO-001",
  "handle": "cabelo-humano-65cm-100g",
  "images": ["https://exemplo.com/foto.jpg"],
  "source_id": "vu-exemplo-001",
  "condition": "novo",
  "requires_shipping": true
}
```

## Importar os anúncios atuais do Venda Única

Configure em `.env`:

```env
PIMATA_LEGACY_SUPABASE_URL=https://SEU-PROJETO.supabase.co
PIMATA_LEGACY_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICAVEL
```

Depois execute:

```bash
npm run import:legacy
```

O importador:

1. lê somente `published=true` e `sold=false`;
2. preserva `id`, `slug`, título, descrição, condição e preço;
3. importa URLs HTTP/HTTPS das três imagens atuais;
4. cria o produto com estoque inicial 1;
5. não importa novamente um produto cujo `handle` já exista.

## Banco de dados

O Medusa usa:

```env
DATABASE_SCHEMA=medusa
```

Isso permite manter as tabelas do Medusa separadas das tabelas legadas caso o PostgreSQL seja compartilhado. Para produção, a preferência é um banco dedicado ou, no mínimo, credenciais e schema exclusivos.

## Redis e processos de produção

Em desenvolvimento:

```env
MEDUSA_WORKER_MODE=shared
```

Em produção devem existir duas instâncias do mesmo backend:

- servidor: `MEDUSA_WORKER_MODE=server` e `DISABLE_MEDUSA_ADMIN=false`;
- worker: `MEDUSA_WORKER_MODE=worker` e `DISABLE_MEDUSA_ADMIN=true`.

Ambas usam o mesmo `DATABASE_URL` e `REDIS_URL`.

## Segurança

`JWT_SECRET` e `COOKIE_SECRET` nunca devem ser versionados. O `medusa-config.ts` bloqueia a inicialização em produção se eles, `DATABASE_URL` ou `REDIS_URL` estiverem ausentes.

O arquivo `.env.template` contém somente placeholders.

## Verificação

Depois de iniciar o backend:

- health nativo: `GET /health` deve responder `OK`;
- status PiMaTa: `GET /pimata/status` retorna a versão e o modo do backend;
- Admin Medusa: `/app` no endereço do servidor.

## Plano de corte sem downtime

1. manter `venda.pimata.app` atual em produção;
2. subir Medusa em um hostname separado;
3. criar estoque/local, canal de vendas, região BRL e perfil de envio no Admin;
4. importar os anúncios ativos com `npm run import:legacy`;
5. validar catálogo, estoque, checkout, pagamento e frete;
6. conectar uma storefront nova ao Store API do Medusa;
7. somente após os testes, trocar a home de `venda.pimata.app` para a nova storefront.

O domínio atual não deve ser apontado para o Medusa antes da etapa 7.
