import type { ExecArgs } from "@medusajs/framework/types"
import { bootstrapPiMaTa } from "../lib/bootstrap-pimata"

export default async function bootstrapPiMaTaScript({ container }: ExecArgs) {
  return bootstrapPiMaTa(container)
}
