import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createVendaUnicaWorkflow } from "../workflows/create-venda-unica"

type LegacyProduct = {
  id: string
  slug?: string | null
  title: string
  description?: string | null
  condition?: string | null
  price: string | number
  sale_price?: string | number | null
  image_url?: string | null
  image2_url?: string | null
  image3_url?: string | null
  published: boolean
  sold: boolean
  created_at?: string | null
}

const isHttpUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value)

export default async function importVendaUnica({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const baseUrl = process.env.PIMATA_LEGACY_SUPABASE_URL
  const apiKey = process.env.PIMATA_LEGACY_SUPABASE_ANON_KEY

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Defina PIMATA_LEGACY_SUPABASE_URL e PIMATA_LEGACY_SUPABASE_ANON_KEY para importar o Venda Única legado."
    )
  }

  const url = new URL(
    `${baseUrl.replace(/\/$/, "")}/rest/v1/venda_unica_products`
  )
  url.searchParams.set(
    "select",
    "id,slug,title,description,condition,price,sale_price,image_url,image2_url,image3_url,published,sold,created_at"
  )
  url.searchParams.set("published", "eq.true")
  url.searchParams.set("sold", "eq.false")
  url.searchParams.set("order", "created_at.asc")

  const response = await fetch(url, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(
      `Falha ao ler Venda Única legado: HTTP ${response.status} ${await response.text()}`
    )
  }

  const rows = (await response.json()) as LegacyProduct[]
  logger.info(`Venda Única legado: ${rows.length} anúncio(s) ativo(s) encontrado(s).`)

  let imported = 0
  let skipped = 0

  for (const row of rows) {
    const handle = row.slug || row.id

    const { data: existing } = await query.graph({
      entity: "product",
      fields: ["id", "handle"],
      filters: { handle },
    })

    if (existing.length) {
      skipped++
      logger.info(`Ignorado ${row.id}: handle ${handle} já existe no Medusa.`)
      continue
    }

    const price = Number(row.sale_price ?? row.price)
    const originalPrice = Number(row.price)

    if (!Number.isFinite(price) || price <= 0) {
      skipped++
      logger.warn(`Ignorado ${row.id}: preço inválido.`)
      continue
    }

    const images = [row.image_url, row.image2_url, row.image3_url].filter(
      isHttpUrl
    )

    await createVendaUnicaWorkflow(container).run({
      input: {
        title: row.title,
        description: row.description || undefined,
        price,
        compare_at_price:
          Number.isFinite(originalPrice) && originalPrice > price
            ? originalPrice
            : undefined,
        sku: `LEGACY-${row.id}`.toUpperCase(),
        handle,
        images,
        source_id: row.id,
        condition: row.condition || undefined,
        requires_shipping: true,
      },
    })

    imported++
    logger.info(`Importado ${row.id}: ${row.title}`)
  }

  logger.info(
    `Importação concluída. Importados: ${imported}. Ignorados: ${skipped}.`
  )
}
