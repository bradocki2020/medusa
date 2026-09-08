import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  res.json({
    service: "pimata-commerce",
    platform: "medusa",
    medusa_version: "2.20.1",
    sale_model: "single-stock-ready",
    database: {
      configured: Boolean(process.env.DATABASE_URL),
      isolation: "dedicated-postgresql-database",
    },
    redis_configured: Boolean(process.env.REDIS_URL),
    worker_mode: process.env.MEDUSA_WORKER_MODE || "shared",
    mercado_pago_configured: Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN),
    mercado_pago_webhook_signature_configured: Boolean(process.env.MERCADO_PAGO_WEBHOOK_SECRET),
    melhor_envio_configured: Boolean(
      process.env.MELHOR_ENVIO_TOKEN && process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE
    ),
    legacy_storefront:
      process.env.PIMATA_LEGACY_STOREFRONT || "https://venda.pimata.app",
  })
}
