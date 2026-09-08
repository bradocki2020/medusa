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
- `pimata_source_id`, condição e preço anterior quando fornecidos;
- peso e dimensões físicas quando fornecidos, usados pela cotação de frete.

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
  "requires_shipping": true,
  "weight_kg": 0.1,
  "width_cm": 20,
  "height_cm": 8,
  "length_cm": 25
}
```

## Bootstrap automático da loja Brasil

Depois das migrations, execute:

```bash
npm run bootstrap
```

O script `src/scripts/bootstrap-pimata.ts` configura de forma idempotente:

- moeda padrão BRL;
- região `Brasil`;
- região fiscal BR;
- canal de vendas `PiMaTa Online`;
- local `Estoque PiMaTa`;
- perfil padrão para produtos físicos;
- fulfillment set nacional;
- retirada PiMaTa grátis;
- Melhor Envio calculado quando configurado;
- publishable API key `PiMaTa Storefront`;
- canal e estoque como padrões da store.

Ele pode ser executado novamente sem duplicar os recursos principais. A CI executa o bootstrap duas vezes e verifica que os registros continuam únicos.

O endereço criado no estoque é deliberadamente um placeholder operacional. O endereço completo deve ser configurado no Admin antes da produção.

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
2. preserva `id`, `slug`, título, descrição, condição, preço atual e preço anterior;
3. preserva peso e dimensões do anúncio;
4. importa até três imagens HTTP/HTTPS por produto;
5. quando uma imagem antiga ainda existir somente como `data:image/...`, usa `venda-unica-image?slot=1/2/3` como ponte HTTP sem gravar base64 no catálogo Medusa;
6. cria o produto com estoque inicial exatamente 1;
7. não importa novamente um produto cujo `handle` já exista.

Os anúncios ativos do legado já tiveram sua mídia normalizada para URLs persistentes no Cloudinary: 10 imagens principais, 3 segundas imagens e 1 terceira imagem. Os `data:` originais permanecem no Supabase somente como fallback.

## Banco de dados — isolamento obrigatório

O Medusa deve usar um **banco PostgreSQL dedicado**.

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/pimata_medusa
```

Não aponte `DATABASE_URL` para o banco PostgreSQL atualmente usado pelo Venda Única/PiMaTa.

O projeto não usa `databaseSchema` customizado. A separação é feita por banco/projeto PostgreSQL dedicado, evitando comportamento inconsistente observado no Medusa v2 entre migrations e runtime com schemas customizados.

Isso mantém o banco legado completamente separado e permite criar, migrar, restaurar ou remover o Medusa sem interferir nas tabelas existentes.

## Redis e processos de produção

Em desenvolvimento:

```env
MEDUSA_WORKER_MODE=shared
```

Em produção devem existir duas instâncias do mesmo backend:

- servidor: `MEDUSA_WORKER_MODE=server` e `DISABLE_MEDUSA_ADMIN=false`;
- worker: `MEDUSA_WORKER_MODE=worker` e `DISABLE_MEDUSA_ADMIN=true`.

Ambas usam o mesmo `DATABASE_URL` e `REDIS_URL`.

A configuração usa Redis para cache, event bus, workflow engine e locking, com namespaces/prefixos próprios da PiMaTa onde aplicável.

## Dependências reproduzíveis

`package-lock.json` é versionado e o projeto usa `npm ci` na CI e no container. Isso impede que deploys sucessivos resolvam versões transitivas diferentes sem uma alteração explícita do lockfile.

O `medusa build` gera `.medusa/server` com seu próprio `package.json` e lockfile de runtime. A CI também executa `npm ci --omit=dev` nesse artefato antes de iniciá-lo em modo de produção.

## Container

`Dockerfile` gera uma imagem de produção baseada em Node 22.12.0. A mesma imagem pode ser usada para servidor e worker, mudando apenas as variáveis de ambiente.

O estágio de build usa o lockfile raiz com `npm ci`; o estágio final usa o lockfile gerado pelo próprio `.medusa/server` com `npm ci --omit=dev`.

## Segurança

`JWT_SECRET` e `COOKIE_SECRET` nunca devem ser versionados. O `medusa-config.ts` bloqueia a inicialização em produção se eles, `DATABASE_URL` ou `REDIS_URL` estiverem ausentes.

O arquivo `.env.template` contém somente placeholders. O workflow dedicado usa somente permissão `contents: read`.

## Verificação automatizada

O workflow `PiMaTa Commerce Check` valida:

1. ausência de segredos versionados;
2. instalação determinística com `npm ci`;
3. integridade de `package.json` e `package-lock.json`;
4. TypeScript;
5. `medusa build`;
6. existência e instalação do lockfile do artefato `.medusa/server`;
7. PostgreSQL 17 dedicado e inicialmente vazio;
8. `medusa db:migrate`;
9. registro real dos providers Mercado Pago e Melhor Envio;
10. Redis 7;
11. bootstrap Brasil;
12. segunda execução do bootstrap para validar idempotência;
13. registros comerciais principais da PiMaTa no banco;
14. inicialização do **artefato compilado** em `NODE_ENV=production`;
15. `GET /health` respondendo `OK`;
16. `GET /pimata/status` confirmando serviço PiMaTa, banco PostgreSQL dedicado e Redis configurado.

Depois de iniciar o backend:

- health nativo: `GET /health` deve responder `OK`;
- status PiMaTa: `GET /pimata/status` retorna versão, isolamento do banco e estado dos providers;
- Admin Medusa: `/app` no endereço do servidor.

## Plano de corte sem downtime

1. manter `venda.pimata.app` atual em produção;
2. provisionar PostgreSQL dedicado e Redis;
3. subir Medusa em um hostname separado, com instâncias `server` e `worker`;
4. executar migrations e `npm run bootstrap`;
5. configurar o endereço real de origem/estoque;
6. configurar URLs e segredos reais de Mercado Pago e Melhor Envio;
7. importar os anúncios ativos com `npm run import:legacy`;
8. validar catálogo, estoque, checkout, pagamento, webhook e frete ponta a ponta;
9. conectar uma storefront nova ao Store API do Medusa;
10. somente após os testes, trocar a home de `venda.pimata.app` para a nova storefront.

O domínio atual não deve ser apontado para o Medusa antes da etapa 10.
