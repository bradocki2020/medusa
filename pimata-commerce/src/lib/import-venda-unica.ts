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
  image_data_uri?: string | null
  image2_url?: string | null
  image2_data_uri?: string | null
  image3_url?: string | null
  image3_data_uri?: string | null
  weight_kg?: string | number | null
  width_cm?: string | number | null
  height_cm?: string | number | null
  length_cm?: string | number | null
  published: boolean
  sold: boolean
  created_at?: string | null
}

const isHttpUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value)

const isImageDataUri = (value: unknown): value is string =>
  typeof value === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)

const positiveNumber = (value: unknown): number | undefined => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

export async function importVendaUnica(container: ExecArgs["container"]) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const baseUrl = process.env.PIMATA_LEGACY_SUPABASE_URL
  const apiKey = process.env.PIMATA_LEGACY_SUPABASE_ANON_KEY

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Defina PIMATA_LEGACY_SUPABASE_URL e PIMATA_LEGACY_SUPABASE_ANON_KEY para importar o Venda Única legado."
    )
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "")
  const imageEndpoint = `${normalizedBaseUrl}/functions/v1/venda-unica-image`
  const url = new URL(`${normalizedBaseUrl}/rest/v1/venda_unica_products`)
  url.searchParams.set(
    "select",
    "id,slug,title,description,condition,price,sale_price,image_url,image_data_uri,image2_url,image2_data_uri,image3_url,image3_data_uri,weight_kg,width_cm,height_cm,length_cm,published,sold,created_at"
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

    const imageSlots = [
      { slot: 1, url: row.image_url, dataUri: row.image_data_uri },
      { slot: 2, url: row.image2_url, dataUri: row.image2_data_uri },
      { slot: 3, url: row.image3_url, dataUri: row.image3_data_uri },
    ]

    const images = imageSlots.flatMap(({ slot, url, dataUri }) => {
      if (isHttpUrl(url)) return [url]
      if (isImageDataUri(dataUri)) {
        return [
          `${imageEndpoint}?id=${encodeURIComponent(row.id)}&slot=${slot}`,
        ]
      }
      return []
    })

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
        weight_kg: positiveNumber(row.weight_kg),
        width_cm: positiveNumber(row.width_cm),
        height_cm: positiveNumber(row.height_cm),
        length_cm: positiveNumber(row.length_cm),
      },
    })

    imported++
    logger.info(
      `Importado ${row.id}: ${row.title} (${images.length} imagem(ns)).`
    )
  }

  logger.info(`Importação concluída. Importados: ${imported}. Ignorados: ${skipped}.`)

  return { imported, skipped, total: rows.length }
}
