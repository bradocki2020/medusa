const baseInput = process.argv[2] || process.env.PIMATA_MEDUSA_BASE_URL

if (!baseInput) {
  console.error("Usage: npm run smoke:production -- https://your-medusa-host")
  process.exit(2)
}

const baseUrl = String(baseInput).replace(/\/+$/, "")

const fail = (message) => {
  throw new Error(message)
}

const healthResponse = await fetch(`${baseUrl}/health`, {
  headers: { Accept: "text/plain" },
})
if (!healthResponse.ok) {
  fail(`GET /health returned HTTP ${healthResponse.status}`)
}
const healthText = (await healthResponse.text()).trim()
if (healthText !== "OK") {
  fail(`GET /health returned unexpected body: ${healthText}`)
}

const statusResponse = await fetch(`${baseUrl}/pimata/status`, {
  headers: { Accept: "application/json" },
})
if (!statusResponse.ok) {
  fail(`GET /pimata/status returned HTTP ${statusResponse.status}`)
}
const status = await statusResponse.json()

if (status.service !== "pimata-commerce") fail("Unexpected service identity")
if (status.platform !== "medusa") fail("Unexpected platform identity")
if (status.database?.configured !== true) fail("DATABASE_URL is not configured")
if (status.database?.isolation !== "dedicated-postgresql-database") {
  fail("Database isolation is not dedicated PostgreSQL")
}
if (status.redis_configured !== true) fail("REDIS_URL is not configured")
if (status.worker_mode !== "server") fail(`Expected server worker mode, got ${status.worker_mode}`)
if (status.mercado_pago_configured !== true) fail("Mercado Pago provider is not configured")
if (status.mercado_pago_webhook_signature_configured !== true) {
  fail("Mercado Pago webhook signature verification is not configured")
}
if (status.melhor_envio_configured !== true) fail("Melhor Envio provider is not configured")

const fakeHash = "0".repeat(64)
const webhookResponse = await fetch(
  `${baseUrl}/hooks/payment/mercadopago_mercadopago?data.id=pimata-smoke-invalid`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "pimata-production-smoke",
      "x-signature": `ts=${Date.now()},v1=${fakeHash}`,
    },
    body: JSON.stringify({
      type: "payment",
      action: "payment.updated",
      data: { id: "pimata-smoke-invalid" },
    }),
  }
)

if (webhookResponse.status !== 401) {
  fail(`Invalid Mercado Pago webhook signature was not rejected with 401 (got ${webhookResponse.status})`)
}

console.log(JSON.stringify({
  ok: true,
  base_url: baseUrl,
  health: healthText,
  medusa_version: status.medusa_version,
  worker_mode: status.worker_mode,
  database_isolation: status.database.isolation,
  redis_configured: status.redis_configured,
  mercado_pago_configured: status.mercado_pago_configured,
  webhook_signature_configured: status.mercado_pago_webhook_signature_configured,
  melhor_envio_configured: status.melhor_envio_configured,
  invalid_webhook_rejected: webhookResponse.status === 401,
}, null, 2))
