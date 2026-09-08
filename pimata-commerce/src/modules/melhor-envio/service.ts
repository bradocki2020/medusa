import type {
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  FulfillmentOption,
} from "@medusajs/framework/types"
import {
  AbstractFulfillmentProviderService,
  MedusaError,
} from "@medusajs/framework/utils"

type MelhorEnvioOptions = {
  token: string
  origin_postal_code: string
  sandbox?: boolean
  user_agent?: string
}

type MelhorEnvioRate = {
  id?: string | number
  name?: string
  price?: string | number
  custom_price?: string | number
  delivery_time?: number
  custom_delivery_time?: number
  error?: string
  company?: { name?: string }
  packages?: unknown[]
}

export default class MelhorEnvioFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "melhor-envio"
  protected options_: MelhorEnvioOptions

  constructor(_: Record<string, unknown>, options: MelhorEnvioOptions) {
    super()
    this.options_ = {
      ...options,
      origin_postal_code: String(options.origin_postal_code || "").replace(/\D/g, ""),
      sandbox: options.sandbox !== false,
      user_agent: options.user_agent || "PiMaTa Commerce (contato@pimata.app)",
    }
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.token) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "MELHOR_ENVIO_TOKEN is required")
    }
    const cep = String(options.origin_postal_code || "").replace(/\D/g, "")
    if (cep.length !== 8) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "MELHOR_ENVIO_ORIGIN_POSTAL_CODE must have 8 digits")
    }
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [{ id: "melhor-envio-cheapest", name: "Melhor Envio — menor preço" }]
  }

  async canCalculate(): Promise<boolean> {
    return true
  }

  async validateOption(data: Record<string, any>): Promise<boolean> {
    return data?.id === "melhor-envio-cheapest"
  }

  private number(value: unknown): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  private async quote(context: any): Promise<MelhorEnvioRate> {
    const to = String(context?.shipping_address?.postal_code || "").replace(/\D/g, "")
    if (to.length !== 8) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "CEP de destino inválido")
    }

    const products = (context?.items || []).map((item: any, index: number) => {
      const variant = item?.variant || {}
      const weightGrams = this.number(variant.weight ?? item.variant_weight)
      const width = this.number(variant.width ?? item.variant_width)
      const height = this.number(variant.height ?? item.variant_height)
      const length = this.number(variant.length ?? item.variant_length)
      if (!(weightGrams > 0 && width > 0 && height > 0 && length > 0)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Peso e dimensões precisam estar cadastrados no item ${item?.title || index + 1}`
        )
      }
      const quantity = Math.max(1, this.number(item?.quantity) || 1)
      const unitPrice = this.number(item?.unit_price)
      return {
        id: String(item?.variant_id || item?.id || index + 1),
        width,
        height,
        length,
        weight: Math.round((weightGrams / 1000) * 1000) / 1000,
        insurance_value: Math.max(0, Math.round(unitPrice * 100) / 100),
        quantity,
      }
    })

    if (!products.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Carrinho sem produtos para cotação")
    }

    const base = this.options_.sandbox
      ? "https://sandbox.melhorenvio.com.br"
      : "https://www.melhorenvio.com.br"
    const response = await fetch(`${base}/api/v2/me/shipment/calculate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options_.token}`,
        "User-Agent": this.options_.user_agent || "PiMaTa Commerce (contato@pimata.app)",
      },
      body: JSON.stringify({
        from: { postal_code: this.options_.origin_postal_code },
        to: { postal_code: to },
        products,
        options: { receipt: false, own_hand: false },
      }),
    })
    const raw = (await response.json().catch(() => [])) as any
    if (!response.ok) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        String(raw?.message || `Melhor Envio HTTP ${response.status}`)
      )
    }

    const rates = (Array.isArray(raw) ? raw : [])
      .filter((rate: MelhorEnvioRate) => rate?.id && !rate.error && (rate.custom_price || rate.price))
      .sort((a: MelhorEnvioRate, b: MelhorEnvioRate) =>
        this.number(a.custom_price || a.price) - this.number(b.custom_price || b.price)
      )

    if (!rates.length) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Melhor Envio não retornou frete disponível")
    }
    return rates[0]
  }

  async calculatePrice(
    _optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: any
  ): Promise<CalculatedShippingOptionPrice> {
    const rate = await this.quote(context)
    return {
      calculated_amount: this.number(rate.custom_price || rate.price),
      is_calculated_price_tax_inclusive: false,
    }
  }

  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: any
  ): Promise<any> {
    const rate = await this.quote(context)
    return {
      ...data,
      melhor_envio_service_id: String(rate.id),
      melhor_envio_service_name: rate.name || "Frete",
      melhor_envio_company: rate.company?.name || "",
      melhor_envio_price: this.number(rate.custom_price || rate.price),
      melhor_envio_delivery_days: Number(rate.custom_delivery_time || rate.delivery_time || 0),
      melhor_envio_packages: rate.packages || [],
    }
  }

  async createFulfillment(
    data: Record<string, unknown>
  ): Promise<CreateFulfillmentResult> {
    // A cotação e o serviço escolhido permanecem no fulfillment. A compra da
    // etiqueta é deliberadamente separada para evitar gerar cobrança automática.
    return { data, labels: [] }
  }

  async cancelFulfillment(): Promise<any> {
    return {}
  }

  async createReturnFulfillment(): Promise<CreateFulfillmentResult> {
    return { data: {}, labels: [] }
  }
}
