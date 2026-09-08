# syntax=docker/dockerfile:1

FROM node:22.12.0-bookworm-slim AS builder
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22.12.0-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9000

COPY --from=builder /app/.medusa/server ./
RUN npm install --omit=dev --no-audit --no-fund

EXPOSE 9000

# A mesma imagem serve para as duas instâncias recomendadas pelo Medusa:
# MEDUSA_WORKER_MODE=server + DISABLE_MEDUSA_ADMIN=false
# MEDUSA_WORKER_MODE=worker + DISABLE_MEDUSA_ADMIN=true
CMD ["npm", "start"]
