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
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateRegionsWorkflow,
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

  const mercadoPagoEnabled = Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN)
  const melhorEnvioEnabled = Boolean(
    process.env.MELHOR_ENVIO_TOKEN && process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE
  )
  const paymentProviders = mercadoPagoEnabled
    ? ["pp_mercadopago_mercadopago"]
    : ["pp_system_default"]

  logger.info("[PiMaTa] Iniciando bootstrap da loja brasileira...")

  const [store] = await storeService.listStores()
  if (!store) throw new Error("Nenhuma store Medusa foi encontrada após as migrations.")

  const { data: existingChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
    filters: { name: "PiMaTa Online" },
  })

  let salesChannelId = existingChannels[0]?.id
  if (!salesChannelId) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "PiMaTa Online" }] },
    })
    salesChannelId = result[0]?.id
    if (!salesChannelId) throw new Error("Falha ao criar o canal de vendas PiMaTa Online.")
    logger.info(`[PiMaTa] Canal criado: ${salesChannelId}`)
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

  let regionId = existingRegions[0]?.id
  if (!regionId) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "Brasil",
            currency_code: "brl",
            countries: ["br"],
            payment_providers: paymentProviders,
          },
        ],
      },
    })
    regionId = result[0]?.id
    if (!regionId) throw new Error("Falha ao criar a região Brasil.")
    logger.info("[PiMaTa] Região Brasil/BRL criada.")
  } else {
    await updateRegionsWorkflow(container).run({
      input: {
        selector: { id: regionId },
        update: { payment_providers: paymentProviders },
      },
    })
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
  }

  const { data: existingLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name", "fulfillment_providers.id", "fulfillment_sets.id"],
    filters: { name: "Estoque PiMaTa" },
  })

  let stockLocationId = existingLocations[0]?.id
  let locationRecord: any = existingLocations[0]
  if (!stockLocationId) {
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
    stockLocationId = result[0]?.id
    if (!stockLocationId) throw new Error("Falha ao criar o local de estoque PiMaTa.")
    locationRecord = { id: stockLocationId, fulfillment_providers: [], fulfillment_sets: [] }
  }

  const linkedProviderIds = new Set(
    (locationRecord?.fulfillment_providers || []).map((provider: any) => provider.id)
  )
  for (const providerId of [
    "manual_manual",
    ...(melhorEnvioEnabled ? ["melhor-envio_melhor-envio"] : []),
  ]) {
    if (!linkedProviderIds.has(providerId)) {
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
        [Modules.FULFILLMENT]: { fulfillment_provider_id: providerId },
      })
    }
  }

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_sales_channel_id: salesChannelId,
        default_location_id: stockLocationId,
      },
    },
  })

  const shippingProfiles = await fulfillmentService.listShippingProfiles({ type: "default" })
  let shippingProfile = shippingProfiles[0]
  if (!shippingProfile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Produtos físicos PiMaTa", type: "default" }] },
    })
    shippingProfile = result[0]
  }
  if (!shippingProfile?.id) throw new Error("Falha ao obter o perfil de envio PiMaTa.")

  const { data: existingSets } = await query.graph({
    entity: "fulfillment_set",
    fields: ["id", "name", "service_zones.id", "service_zones.name"],
    filters: { name: "PiMaTa Brasil delivery" },
  })

  let fulfillmentSet: any = existingSets[0]
  if (!fulfillmentSet) {
    fulfillmentSet = await fulfillmentService.createFulfillmentSets({
      name: "PiMaTa Brasil delivery",
      type: "shipping",
      service_zones: [
        {
          name: "Brasil",
          geo_zones: [{ country_code: "br", type: "country" }],
        },
      ],
    })
  }
  const serviceZoneId = fulfillmentSet?.service_zones?.[0]?.id
  if (!fulfillmentSet?.id || !serviceZoneId) {
    throw new Error("Falha ao configurar a zona de entrega Brasil.")
  }

  const linkedSetIds = new Set(
    (locationRecord?.fulfillment_sets || []).map((set: any) => set.id)
  )
  if (!linkedSetIds.has(fulfillmentSet.id)) {
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    })
  }

  const { data: existingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "provider_id", "service_zone_id"],
  })
  const optionNames = new Set(existingOptions.map((option: any) => option.name))
  const options: any[] = []

  if (!optionNames.has("Retirada PiMaTa")) {
    options.push({
      name: "Retirada PiMaTa",
      price_type: "flat",
      provider_id: "manual_manual",
      service_zone_id: serviceZoneId,
      shipping_profile_id: shippingProfile.id,
      type: {
        label: "Retirada grátis",
        description: "Retirada no local após confirmação do pagamento.",
        code: "pimata-pickup",
      },
      prices: [{ region_id: regionId, amount: 0 }],
      rules: [
        { attribute: "enabled_in_store", value: "true", operator: "eq" },
        { attribute: "is_return", value: "false", operator: "eq" },
      ],
    })
  }

  if (melhorEnvioEnabled && !optionNames.has("Melhor Envio — menor preço")) {
    options.push({
      name: "Melhor Envio — menor preço",
      price_type: "calculated",
      provider_id: "melhor-envio_melhor-envio",
      service_zone_id: serviceZoneId,
      shipping_profile_id: shippingProfile.id,
      data: {
        id: "melhor-envio-cheapest",
        name: "Melhor Envio — menor preço",
      },
      type: {
        label: "Melhor Envio",
        description: "Frete calculado pelo CEP de destino.",
        code: "pimata-melhor-envio",
      },
      rules: [
        { attribute: "enabled_in_store", value: "true", operator: "eq" },
        { attribute: "is_return", value: "false", operator: "eq" },
      ],
    })
  }

  if (options.length) {
    await createShippingOptionsWorkflow(container).run({ input: options })
  }

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocationId, add: [salesChannelId] },
  })

  const { data: existingKeys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "type"],
    filters: { type: "publishable" },
  })
  let publishableKeyId = existingKeys.find(
    (key) => key.title === "PiMaTa Storefront"
  )?.id
  if (!publishableKeyId) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [{ title: "PiMaTa Storefront", type: "publishable", created_by: "" }],
      },
    })
    publishableKeyId = result[0]?.id
    if (!publishableKeyId) throw new Error("Falha ao criar a chave publicável PiMaTa.")
  }
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: publishableKeyId, add: [salesChannelId] },
  })

  logger.info("[PiMaTa] Bootstrap concluído com sucesso.")
  logger.info(`[PiMaTa] Store: ${store.id}`)
  logger.info(`[PiMaTa] Região Brasil: ${regionId}`)
  logger.info(`[PiMaTa] Sales channel: ${salesChannelId}`)
  logger.info(`[PiMaTa] Stock location: ${stockLocationId}`)
  logger.info(`[PiMaTa] Publishable API key id: ${publishableKeyId}`)
  logger.info(`[PiMaTa] Mercado Pago: ${mercadoPagoEnabled ? "habilitado" : "não configurado"}`)
  logger.info(`[PiMaTa] Melhor Envio: ${melhorEnvioEnabled ? "habilitado" : "não configurado"}`)
}
