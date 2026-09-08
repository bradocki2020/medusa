import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  res.json({
    service: "pimata-commerce",
    platform: "medusa",
    medusa_version: "2.20.1",
    sale_model: "single-stock-ready",
    database_schema: process.env.DATABASE_SCHEMA || "medusa",
    legacy_storefront:
      process.env.PIMATA_LEGACY_STOREFRONT || "https://venda.pimata.app",
  })
}
