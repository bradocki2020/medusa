import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { defineMiddlewares } from "@medusajs/framework/http"
import { verifyMercadoPagoWebhookSignature } from "../modules/mercado-pago/webhook-signature"

const firstString = (value: unknown): string => {
  if (Array.isArray(value)) return String(value[0] || "")
  if (value == null) return ""
  return String(value)
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/hooks/payment/mercadopago_mercadopago",
      method: ["POST"],
      middlewares: [
        (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
          const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET || ""
          if (!secret) {
            return res.status(503).json({ message: "Mercado Pago webhook verification is not configured" })
          }

          const query = (req.query || {}) as Record<string, unknown>
          const nestedData = (query.data || {}) as Record<string, unknown>
          const dataId =
            firstString(query["data.id"]) ||
            firstString(query["data_id"]) ||
            firstString(nestedData.id) ||
            undefined

          const valid = verifyMercadoPagoWebhookSignature({
            secret,
            headers: req.headers as Record<string, unknown>,
            dataId,
          })

          if (!valid) {
            return res.status(401).json({ message: "Invalid Mercado Pago webhook signature" })
          }

          return next()
        },
      ],
    },
  ],
})
