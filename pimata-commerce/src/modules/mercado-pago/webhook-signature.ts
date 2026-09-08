import { createHmac, timingSafeEqual } from "node:crypto"

type VerifyMercadoPagoWebhookSignatureInput = {
  secret: string
  headers: Record<string, unknown>
  dataId?: string | null
}

const headerValue = (headers: Record<string, unknown>, name: string): string => {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() !== target || value == null) continue
    if (Array.isArray(value)) return String(value[0] || "")
    return String(value)
  }
  return ""
}

export function verifyMercadoPagoWebhookSignature(
  input: VerifyMercadoPagoWebhookSignatureInput
): boolean {
  const secret = String(input.secret || "")
  const signature = headerValue(input.headers, "x-signature")
  const requestId = headerValue(input.headers, "x-request-id")
  if (!secret || !signature) return false

  const signatureParts = new Map<string, string>()
  for (const part of signature.split(",")) {
    const separator = part.indexOf("=")
    if (separator <= 0) continue
    signatureParts.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim())
  }

  const timestamp = signatureParts.get("ts") || ""
  const receivedHash = signatureParts.get("v1") || ""
  if (!timestamp || !/^[a-f0-9]{64}$/i.test(receivedHash)) return false

  // Mercado Pago manifest: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
  // Missing values are omitted, matching the official WebhookSignatureValidator.
  let manifest = ""
  if (input.dataId) manifest += `id:${String(input.dataId)};`
  if (requestId) manifest += `request-id:${requestId};`
  manifest += `ts:${timestamp};`

  const expected = createHmac("sha256", secret).update(manifest).digest()
  const received = Buffer.from(receivedHash, "hex")
  return received.length === expected.length && timingSafeEqual(received, expected)
}
