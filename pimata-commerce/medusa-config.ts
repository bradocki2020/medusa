import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const isProduction = process.env.NODE_ENV === "production"

function requiredSecret(name: "JWT_SECRET" | "COOKIE_SECRET", devFallback: string) {
  const value = process.env[name]
  if (value) return value
  if (isProduction) {
    throw new Error(`${name} is required in production`)
  }
  return devFallback
}

if (isProduction && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in production")
}

if (isProduction && !process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required in production")
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseSchema: process.env.DATABASE_SCHEMA || "medusa",
    redisUrl: process.env.REDIS_URL,
    workerMode: (process.env.MEDUSA_WORKER_MODE || "shared") as
      | "shared"
      | "worker"
      | "server",
    http: {
      storeCors:
        process.env.STORE_CORS ||
        "http://localhost:8000,https://venda.pimata.app",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9000",
      authCors:
        process.env.AUTH_CORS ||
        "http://localhost:8000,http://localhost:9000,https://venda.pimata.app",
      jwtSecret: requiredSecret("JWT_SECRET", "pimata-dev-jwt-change-me"),
      cookieSecret: requiredSecret(
        "COOKIE_SECRET",
        "pimata-dev-cookie-change-me"
      ),
    },
  },
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: process.env.MEDUSA_BACKEND_URL,
  },
})
