import type { CreateProductWorkflowInputDTO } from "@medusajs/framework/types"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  createInventoryItemsWorkflow,
  createProductsWorkflow,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"

export type CreateVendaUnicaInput = {
  title: string
  description?: string
  price: number
  compare_at_price?: number
  sku?: string
  handle?: string
  images?: string[]
  source_id?: string
  condition?: string
  requires_shipping?: boolean
}

export const createVendaUnicaWorkflow = createWorkflow(
  "pimata-create-venda-unica",
  (input: CreateVendaUnicaInput) => {
    const { data: stores } = useQueryGraphStep({
      entity: "store",
      fields: ["id", "default_location_id", "default_sales_channel_id"],
    })

    const { data: shippingProfiles } = useQueryGraphStep({
      entity: "shipping_profile",
      fields: ["id", "name"],
    }).config({ name: "pimata-get-shipping-profile" })

    const inventoryItemsData = transform({ input, stores }, (data) => {
      const store = data.stores[0]
      if (!store?.default_location_id) {
        throw new Error(
          "A loja Medusa precisa ter um estoque/local padrão antes de criar Venda Única."
        )
      }

      const sku =
        data.input.sku ||
        `VU-${String(
          data.input.source_id || data.input.handle || Date.now()
        )}`.toUpperCase()

      return [
        {
          sku,
          title: data.input.title,
          description: data.input.description || "Peça única PiMaTa",
          requires_shipping: data.input.requires_shipping !== false,
          location_levels: [
            {
              location_id: store.default_location_id,
              stocked_quantity: 1,
            },
          ],
        },
      ]
    })

    const inventoryItems = createInventoryItemsWorkflow.runAsStep({
      input: {
        items: inventoryItemsData,
      },
    })

    const productData = transform(
      { input, stores, shippingProfiles, inventoryItems },
      (data) => {
        const store = data.stores[0]
        const shippingProfile = data.shippingProfiles[0]

        if (!store?.default_sales_channel_id) {
          throw new Error(
            "A loja Medusa precisa ter um canal de vendas padrão antes de criar Venda Única."
          )
        }
        if (!shippingProfile?.id) {
          throw new Error(
            "A loja Medusa precisa ter um perfil de envio antes de criar Venda Única."
          )
        }
        if (!data.inventoryItems[0]?.id || !data.inventoryItems[0]?.sku) {
          throw new Error("Falha ao criar o item de estoque da Venda Única.")
        }

        const images = (data.input.images || []).filter(Boolean)
        const metadata: Record<string, string | number | boolean> = {
          pimata_sale_type: "venda_unica",
          pimata_single_stock: true,
        }

        if (data.input.source_id) {
          metadata.pimata_source_id = data.input.source_id
        }
        if (data.input.condition) {
          metadata.pimata_condition = data.input.condition
        }
        if (typeof data.input.compare_at_price === "number") {
          metadata.pimata_compare_at_price = data.input.compare_at_price
        }

        const product: CreateProductWorkflowInputDTO = {
          title: data.input.title,
          description: data.input.description || "",
          status: "published",
          handle: data.input.handle,
          thumbnail: images[0],
          images: images.map((url) => ({ url })),
          shipping_profile_id: shippingProfile.id,
          sales_channels: [{ id: store.default_sales_channel_id }],
          metadata,
          options: [
            {
              title: "Peça",
              values: ["Única"],
            },
          ],
          variants: [
            {
              title: "Peça única",
              sku: data.inventoryItems[0].sku,
              manage_inventory: true,
              allow_backorder: false,
              options: {
                Peça: "Única",
              },
              inventory_items: [
                {
                  inventory_item_id: data.inventoryItems[0].id,
                },
              ],
              prices: [
                {
                  amount: data.input.price,
                  currency_code: "brl",
                },
              ],
            },
          ],
        }

        return [product]
      }
    )

    const products = createProductsWorkflow.runAsStep({
      input: {
        products: productData,
      },
    })

    return new WorkflowResponse({ products })
  }
)
