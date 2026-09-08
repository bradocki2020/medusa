import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresStep,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

const updateStoreCurrencies = createWorkflow(
  "pimata-update-store-currencies",
  (input: {
    store_id: string
    supported_currencies: { currency_code: string; is_default?: boolean }[]
  }) => {
    const normalized = transform({ input }, (data) => ({
      selector: { id: data.input.store_id },
      update: {
        supported_currencies: data.input.supported_currencies.map((currency) => ({
          currency_code: currency.currency_code,
          is_default: currency.is_default ?? false,
        })),
      },
    }))

    const stores = updateStoresStep(normalized)
    return new WorkflowResponse(stores)
  }
)

export default async function bootstrapPiMaTa({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const storeService = container.resolve(Modules.STORE)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)

  logger.info("[PiMaTa] Iniciando bootstrap da loja brasileira...")

  const [store] = await storeService.listStores()
  if (!store) {
    throw new Error("Nenhuma store Medusa foi encontrada após as migrations.")
  }

  const { data: existingChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
    filters: { name: "PiMaTa Online" },
  })

  let salesChannel = existingChannels[0]
  if (!salesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [{ name: "PiMaTa Online" }],
      },
    })
    salesChannel = result[0]
    logger.info(`[PiMaTa] Canal criado: ${salesChannel.id}`)
  }

  await updateStoreCurrencies(container).run({
    input: {
      store_id: store.id,
      supported_currencies: [{ currency_code: "brl", is_default: true }],
    },
  })

  const { data: existingRegions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
    filters: { name: "Brasil" },
  })

  if (!existingRegions.length) {
    await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "Brasil",
            currency_code: "brl",
            countries: ["br"],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    })
    logger.info("[PiMaTa] Região Brasil/BRL criada.")
  }

  const { data: existingTaxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "country_code"],
    filters: { country_code: "br" },
  })

  if (!existingTaxRegions.length) {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: "br", provider_id: "tp_system" }],
    })
    logger.info("[PiMaTa] Região fiscal BR criada.")
  }

  const { data: existingLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
    filters: { name: "Estoque PiMaTa" },
  })

  let stockLocation = existingLocations[0]
  let createdStockLocation = false

  if (!stockLocation) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: "Estoque PiMaTa",
            address: {
              city: "Mogi Mirim",
              province: "SP",
              country_code: "BR",
              address_1: "Configurar endereço no Admin antes da produção",
            },
          },
        ],
      },
    })
    stockLocation = result[0]
    createdStockLocation = true
    logger.info(`[PiMaTa] Local de estoque criado: ${stockLocation.id}`)
  }

  if (createdStockLocation) {
    await link.create({
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
      [Modules.FULFILLMENT]: {
        fulfillment_provider_id: "manual_manual",
      },
    })

    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: {
        id: stockLocation.id,
        add: [salesChannel.id],
      },
    })
  }

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_sales_channel_id: salesChannel.id,
        default_location_id: stockLocation.id,
      },
    },
  })

  const shippingProfiles = await fulfillmentService.listShippingProfiles({
    type: "default",
  })

  if (!shippingProfiles.length) {
    await createShippingProfilesWorkflow(container).run({
      input: {
        data: [
          {
            name: "Produtos físicos PiMaTa",
            type: "default",
          },
        ],
      },
    })
    logger.info("[PiMaTa] Perfil padrão de envio criado.")
  }

  const { data: existingKeys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "type"],
    filters: { type: "publishable" },
  })

  let publishableKey = existingKeys.find(
    (key) => key.title === "PiMaTa Storefront"
  )

  if (!publishableKey) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: "PiMaTa Storefront",
            type: "publishable",
            created_by: "",
          },
        ],
      },
    })
    publishableKey = result[0]

    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: {
        id: publishableKey.id,
        add: [salesChannel.id],
      },
    })

    logger.info(`[PiMaTa] Chave publicável criada: ${publishableKey.id}`)
  }

  logger.info("[PiMaTa] Bootstrap concluído com sucesso.")
  logger.info(`[PiMaTa] Store: ${store.id}`)
  logger.info(`[PiMaTa] Sales channel: ${salesChannel.id}`)
  logger.info(`[PiMaTa] Stock location: ${stockLocation.id}`)
  logger.info(`[PiMaTa] Publishable API key id: ${publishableKey.id}`)
}
