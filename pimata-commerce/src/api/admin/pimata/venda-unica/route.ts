import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { createVendaUnicaWorkflow } from "../../../../workflows/create-venda-unica"

const CreateVendaUnicaSchema = z.object({
  title: z.string().trim().min(3).max(250),
  description: z.string().max(10000).optional(),
  price: z.coerce.number().positive(),
  compare_at_price: z.coerce.number().positive().optional(),
  sku: z.string().trim().min(1).max(100).optional(),
  handle: z.string().trim().min(1).max(250).optional(),
  images: z.array(z.string().url()).max(20).optional(),
  source_id: z.string().trim().min(1).max(250).optional(),
  condition: z.string().trim().max(100).optional(),
  requires_shipping: z.boolean().optional(),
})

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const input = CreateVendaUnicaSchema.parse(req.body)

  const { result } = await createVendaUnicaWorkflow(req.scope).run({
    input,
  })

  res.status(201).json({
    product: result.products[0],
    stock_policy: {
      managed_inventory: true,
      initial_quantity: 1,
      remove_from_store_when_out_of_stock: true,
    },
  })
}
