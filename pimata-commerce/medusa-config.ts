import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const isProduction = process.env.NODE_ENV === "production"
const redisUrl = process.env.REDIS_URL

function requiredSecret(name: "JWT_SECRET" | "COOKIE_SECRET", devFallback: string) {
  const value = process.env[name]
  if (value) return value
  if (isProduction) throw new Error(`${name} is required in production`)
  return devFallback
}

if (isProduction && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required in production")
if (isProduction && !redisUrl) throw new Error("REDIS_URL is required in production")
if (
  isProduction &&
  process.env.MERCADO_PAGO_ACCESS_TOKEN &&
  !process.env.MERCADO_PAGO_WEBHOOK_SECRET
) {
  throw new Error("MERCADO_PAGO_WEBHOOK_SECRET is required in production when Mercado Pago is enabled")
}

const modules: any[] = []

if (redisUrl) {
  modules.push(
    {
      resolve: "@medusajs/medusa/caching",
      options: {
        providers: [{
          resolve: "@medusajs/caching-redis",
          id: "caching-redis",
          is_default: true,
          options: { redisUrl, prefix: "pimata:cache:" },
        }],
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl,
        jobOptions: {
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 3600, count: 1000 },
        },
      },
    },
    { resolve: "@medusajs/medusa/workflow-engine-redis", options: { redis: { redisUrl } } },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [{
          resolve: "@medusajs/medusa/locking-redis",
          id: "locking-redis",
          is_default: true,
          options: { redisUrl, namespace: "pimata_lock:" },
        }],
      },
    }
  )
}

if (process.env.MERCADO_PAGO_ACCESS_TOKEN) {
  modules.push({
    resolve: "@medusajs/medusa/payment",
    options: {
      providers: [{
        resolve: "./src/modules/mercado-pago",
        id: "mercadopago",
        options: {
          access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN,
          backend_url: process.env.MERCADO_PAGO_BACKEND_URL || process.env.MEDUSA_BACKEND_URL || "http://localhost:9000",
          storefront_url: process.env.MERCADO_PAGO_STOREFRONT_URL || "https://venda.pimata.app",
          statement_descriptor: process.env.MERCADO_PAGO_STATEMENT_DESCRIPTOR || "PIMATA",
        },
      }],
    },
  })
}

if (process.env.MELHOR_ENVIO_TOKEN && process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE) {
  modules.push({
    resolve: "@medusajs/medusa/fulfillment",
    options: {
      providers: [
        { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
        {
          resolve: "./src/modules/melhor-envio",
          id: "melhor-envio",
          options: {
            token: process.env.MELHOR_ENVIO_TOKEN,
            origin_postal_code: process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE,
            sandbox: process.env.MELHOR_ENVIO_SANDBOX !== "false",
            user_agent: process.env.MELHOR_ENVIO_USER_AGENT || "PiMaTa Commerce (contato@pimata.app)",
          },
        },
      ],
    },
  })
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl,
    workerMode: (process.env.MEDUSA_WORKER_MODE || "shared") as "shared" | "worker" | "server",
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000,https://venda.pimata.app",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9000",
      authCors: process.env.AUTH_CORS || "http://localhost:8000,http://localhost:9000,https://venda.pimata.app",
      jwtSecret: requiredSecret("JWT_SECRET", "pimata-dev-jwt-change-me"),
      cookieSecret: requiredSecret("COOKIE_SECRET", "pimata-dev-cookie-change-me"),
    },
  },
  modules,
  featureFlags: { caching: Boolean(redisUrl) },
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: process.env.MEDUSA_BACKEND_URL,
  },
})
