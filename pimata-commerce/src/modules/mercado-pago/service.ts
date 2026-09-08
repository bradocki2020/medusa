import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  BigNumber,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

type MercadoPagoOptions = {
  access_token: string
  backend_url: string
  storefront_url: string
  statement_descriptor?: string
}

type MercadoPagoPayment = {
  id?: number | string
  status?: string
  status_detail?: string
  transaction_amount?: number
  currency_id?: string
  external_reference?: string
}

type MercadoPagoPreference = {
  id?: string
  init_point?: string
  sandbox_init_point?: string
}

type MercadoPagoSearch = {
  results?: MercadoPagoPayment[]
}

export default class MercadoPagoPaymentProviderService extends AbstractPaymentProvider<MercadoPagoOptions> {
  static identifier = "mercadopago"
  protected options_: MercadoPagoOptions

  constructor(container: Record<string, unknown>, options: MercadoPagoOptions) {
    super(container, options)
    this.options_ = {
      statement_descriptor: "PIMATA",
      ...options,
      backend_url: String(options.backend_url || "").replace(/\/+$/, ""),
      storefront_url: String(options.storefront_url || "").replace(/\/+$/, ""),
    }
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.access_token) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "MERCADO_PAGO_ACCESS_TOKEN is required")
    }
    if (!options.backend_url) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "MERCADO_PAGO_BACKEND_URL is required")
    }
    if (!options.storefront_url) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "MERCADO_PAGO_STOREFRONT_URL is required")
    }
  }

  private toAmount(value: unknown): number {
    const amount = Number(new BigNumber(value as any).numeric)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Payment amount must be greater than zero")
    }
    return Math.round(amount * 100) / 100
  }

  private async request<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
    const headers = new Headers(init.headers || {})
    headers.set("Authorization", `Bearer ${this.options_.access_token}`)
    headers.set("Accept", "application/json")
    if (init.body) headers.set("Content-Type", "application/json")
    if (idempotencyKey) headers.set("X-Idempotency-Key", idempotencyKey)

    const response = await fetch(`https://api.mercadopago.com${path}`, { ...init, headers })
    const data = (await response.json().catch(() => ({}))) as any
    if (!response.ok) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        String(data?.message || data?.error || `Mercado Pago HTTP ${response.status}`)
      )
    }
    return data as T
  }

  private async createPreference(input: {
    amount: unknown
    currency_code: string
    session_id: string
    idempotency_key?: string
  }): Promise<MercadoPagoPreference> {
    const amount = this.toAmount(input.amount)
    const currency = input.currency_code.toUpperCase()
    const returnUrl = `${this.options_.storefront_url}/checkout/mercado-pago`
    const notificationUrl = `${this.options_.backend_url}/hooks/payment/mercadopago_mercadopago`

    const preference = await this.request<MercadoPagoPreference>(
      "/checkout/preferences",
      {
        method: "POST",
        body: JSON.stringify({
          items: [{
            id: input.session_id,
            title: "Pedido PiMaTa",
            quantity: 1,
            currency_id: currency,
            unit_price: amount,
          }],
          external_reference: input.session_id,
          back_urls: {
            success: `${returnUrl}?status=success&session_id=${encodeURIComponent(input.session_id)}`,
            pending: `${returnUrl}?status=pending&session_id=${encodeURIComponent(input.session_id)}`,
            failure: `${returnUrl}?status=failure&session_id=${encodeURIComponent(input.session_id)}`,
          },
          auto_return: "approved",
          notification_url: notificationUrl,
          statement_descriptor: this.options_.statement_descriptor || "PIMATA",
        }),
      },
      input.idempotency_key
    )

    if (!preference.id || !preference.init_point) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Mercado Pago did not return a checkout URL")
    }
    return preference
  }

  private async findPayment(data?: Record<string, unknown> | null): Promise<MercadoPagoPayment | null> {
    if (data?.payment_id) {
      return await this.request<MercadoPagoPayment>(
        `/v1/payments/${encodeURIComponent(String(data.payment_id))}`
      )
    }

    const sessionId = data?.session_id
    if (!sessionId) return null

    const params = new URLSearchParams({
      external_reference: String(sessionId),
      sort: "date_created",
      criteria: "desc",
      limit: "10",
    })
    const search = await this.request<MercadoPagoSearch>(`/v1/payments/search?${params.toString()}`)
    return search.results?.[0] || null
  }

  private statusFromPayment(payment: MercadoPagoPayment | null): PaymentSessionStatus {
    if (!payment) return PaymentSessionStatus.PENDING_AUTHORIZATION
    switch (String(payment.status || "").toLowerCase()) {
      case "approved":
        return PaymentSessionStatus.CAPTURED
      case "cancelled":
      case "canceled":
      case "refunded":
      case "charged_back":
        return PaymentSessionStatus.CANCELED
      case "rejected":
        return PaymentSessionStatus.ERROR
      default:
        return PaymentSessionStatus.PENDING_AUTHORIZATION
    }
  }

  private mergePaymentData(
    current: Record<string, unknown> | null | undefined,
    payment: MercadoPagoPayment | null
  ): Record<string, unknown> {
    if (!payment) return { ...(current || {}) }
    return {
      ...(current || {}),
      payment_id: payment.id ? String(payment.id) : current?.payment_id,
      payment_status: payment.status,
      payment_status_detail: payment.status_detail,
      currency_code: payment.currency_id?.toLowerCase() || current?.currency_code,
      transaction_amount: payment.transaction_amount,
    }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionId = String(input.data?.session_id || "")
    if (!sessionId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Medusa payment session ID is required")
    }
    const preference = await this.createPreference({
      amount: input.amount,
      currency_code: input.currency_code,
      session_id: sessionId,
      idempotency_key: input.context?.idempotency_key,
    })
    return {
      id: preference.id!,
      data: {
        preference_id: preference.id,
        checkout_url: preference.init_point,
        sandbox_checkout_url: preference.sandbox_init_point,
        session_id: sessionId,
        currency_code: input.currency_code,
        amount: this.toAmount(input.amount),
      },
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const payment = await this.findPayment(input.data)
    return { data: this.mergePaymentData(input.data, payment), status: this.statusFromPayment(payment) }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const payment = await this.findPayment(input.data)
    return { data: this.mergePaymentData(input.data, payment), status: this.statusFromPayment(payment) }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const payment = await this.findPayment(input.data)
    if (payment && String(payment.status).toLowerCase() !== "approved") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Mercado Pago payment is not approved: ${payment.status || "unknown"}`
      )
    }
    return { data: this.mergePaymentData(input.data, payment) }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const payment = await this.findPayment(input.data)
    if (!payment?.id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Mercado Pago payment ID is required for refund")
    }
    await this.request(
      `/v1/payments/${encodeURIComponent(String(payment.id))}/refunds`,
      { method: "POST", body: JSON.stringify({ amount: this.toAmount(input.amount) }) },
      input.context?.idempotency_key || crypto.randomUUID()
    )
    return { data: this.mergePaymentData(input.data, payment) }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const payment = await this.findPayment(input.data)
    return { data: this.mergePaymentData(input.data, payment) }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const preferenceId = input.data?.preference_id
    const sessionId = String(input.data?.session_id || "")
    if (!preferenceId || !sessionId) {
      const preference = await this.createPreference({
        amount: input.amount,
        currency_code: input.currency_code,
        session_id: sessionId || String(preferenceId || crypto.randomUUID()),
        idempotency_key: input.context?.idempotency_key,
      })
      return {
        data: {
          ...input.data,
          preference_id: preference.id,
          checkout_url: preference.init_point,
          sandbox_checkout_url: preference.sandbox_init_point,
          session_id: sessionId,
          amount: this.toAmount(input.amount),
          currency_code: input.currency_code,
        },
        status: PaymentSessionStatus.PENDING_AUTHORIZATION,
      }
    }

    await this.request(
      `/checkout/preferences/${encodeURIComponent(String(preferenceId))}`,
      {
        method: "PUT",
        body: JSON.stringify({
          items: [{
            id: sessionId,
            title: "Pedido PiMaTa",
            quantity: 1,
            currency_id: input.currency_code.toUpperCase(),
            unit_price: this.toAmount(input.amount),
          }],
        }),
      },
      input.context?.idempotency_key
    )
    return {
      data: { ...input.data, amount: this.toAmount(input.amount), currency_code: input.currency_code },
      status: PaymentSessionStatus.PENDING_AUTHORIZATION,
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: { ...(input.data || {}), canceled_in_medusa: true } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: { ...(input.data || {}), deleted_in_medusa: true } }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    try {
      const body = (payload.data || {}) as any
      const paymentId = body?.data?.id || body?.id || body?.resource
      if (!paymentId) return { action: PaymentActions.NOT_SUPPORTED }

      // Never trust status, amount, or reference from the raw webhook.
      const payment = await this.request<MercadoPagoPayment>(
        `/v1/payments/${encodeURIComponent(String(paymentId))}`
      )
      const sessionId = String(payment.external_reference || "")
      if (!sessionId) return { action: PaymentActions.NOT_SUPPORTED }

      const data = {
        session_id: sessionId,
        amount: new BigNumber(payment.transaction_amount || 0),
      }
      switch (String(payment.status || "").toLowerCase()) {
        case "approved":
          return { action: PaymentActions.SUCCESSFUL, data }
        case "rejected":
          return { action: PaymentActions.FAILED, data }
        case "cancelled":
        case "canceled":
        case "refunded":
        case "charged_back":
          return { action: PaymentActions.CANCELED, data }
        case "pending":
        case "in_process":
        case "authorized":
          return { action: PaymentActions.PENDING_AUTHORIZATION, data }
        default:
          return { action: PaymentActions.NOT_SUPPORTED, data }
      }
    } catch {
      return { action: PaymentActions.NOT_SUPPORTED }
    }
  }
}
