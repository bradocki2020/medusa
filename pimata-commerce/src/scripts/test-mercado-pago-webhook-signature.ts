import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { verifyMercadoPagoWebhookSignature } from "../modules/mercado-pago/webhook-signature"

const secret = "ci-mercado-pago-webhook-secret"
const dataId = "123456789"
const requestId = "4ed4fa2b-0b31-42ec-a62f-ad793c486c59"
const timestamp = "1781009491"
const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`
const hash = createHmac("sha256", secret).update(manifest).digest("hex")

assert.equal(
  verifyMercadoPagoWebhookSignature({
    secret,
    dataId,
    headers: {
      "X-Request-Id": requestId,
      "X-Signature": `ts=${timestamp},v1=${hash}`,
    },
  }),
  true,
  "valid Mercado Pago HMAC signature must be accepted"
)

assert.equal(
  verifyMercadoPagoWebhookSignature({
    secret,
    dataId,
    headers: {
      "x-request-id": requestId,
      "x-signature": `ts=${timestamp},v1=${"0".repeat(64)}`,
    },
  }),
  false,
  "tampered Mercado Pago HMAC signature must be rejected"
)

const noIdManifest = `request-id:${requestId};ts:${timestamp};`
const noIdHash = createHmac("sha256", secret).update(noIdManifest).digest("hex")
assert.equal(
  verifyMercadoPagoWebhookSignature({
    secret,
    headers: {
      "x-request-id": requestId,
      "x-signature": `ts=${timestamp},v1=${noIdHash}`,
    },
  }),
  true,
  "manifest must omit absent data.id exactly as Mercado Pago specifies"
)

console.log("Mercado Pago webhook signature verification: OK")
