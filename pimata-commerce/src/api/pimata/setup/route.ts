import { createHash, timingSafeEqual } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { bootstrapPiMaTa } from "../../../lib/bootstrap-pimata"
import { importVendaUnica } from "../../../lib/import-venda-unica"

function safeSecretEquals(provided: string, expected: string): boolean {
  const providedHash = createHash("sha256").update(provided).digest()
  const expectedHash = createHash("sha256").update(expected).digest()
  return timingSafeEqual(providedHash, expectedHash)
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const expected = process.env.PIMATA_SETUP_SECRET
  if (!expected) {
    return res.status(404).json({ message: "Not found" })
  }

  const header = req.headers["x-pimata-setup-secret"]
  const provided = Array.isArray(header) ? header[0] : header
  if (!provided || !safeSecretEquals(String(provided), expected)) {
    return res.status(401).json({ message: "Invalid setup secret" })
  }

  const body = (req.body || {}) as { import_legacy?: boolean }

  await bootstrapPiMaTa(req.scope as any)

  let legacy: { imported: number; skipped: number; total: number } | null = null
  if (body.import_legacy === true) {
    const legacyKey =
      process.env.PIMATA_LEGACY_SUPABASE_PUBLISHABLE_KEY ||
      process.env.PIMATA_LEGACY_SUPABASE_ANON_KEY

    if (!process.env.PIMATA_LEGACY_SUPABASE_URL || !legacyKey) {
      return res.status(400).json({
        message:
          "PIMATA_LEGACY_SUPABASE_URL e uma chave pública Supabase (PUBLISHABLE_KEY ou ANON_KEY legado) são obrigatórios para importar o legado.",
      })
    }

    legacy = await importVendaUnica(req.scope as any)
  }

  return res.status(200).json({
    ok: true,
    bootstrap: "completed",
    legacy_import: legacy ? "completed" : "skipped",
    legacy,
    next: "remove PIMATA_SETUP_SECRET and redeploy",
  })
}
