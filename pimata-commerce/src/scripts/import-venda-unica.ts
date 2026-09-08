import type { ExecArgs } from "@medusajs/framework/types"
import { importVendaUnica } from "../lib/import-venda-unica"

export default async function importVendaUnicaScript({ container }: ExecArgs) {
  return importVendaUnica(container)
}
