param(
  [string]$ProjectName = "pimata-commerce",
  [string]$Repo = "bradocki2020/medusa",
  [string]$Branch = "pimata-commerce",
  [string]$StorefrontUrl = "https://venda.pimata.app"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-EnvironmentVariable([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Defina a variavel de ambiente $Name antes de executar este provisionador."
  }
  return $value
}

function New-RandomHex([int]$Bytes = 48) {
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return ([Convert]::ToHexString($buffer)).ToLowerInvariant()
}

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Railway CLI e npm nao encontrados. Instale Node.js 22.12+ e execute novamente."
  }
  npm install -g @railway/cli
}

railway whoami | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Railway nao autenticado. Execute 'railway login' ou conecte o app Railway ao ChatGPT."
}

$mpToken = Require-EnvironmentVariable "MERCADO_PAGO_ACCESS_TOKEN"
$mpWebhookSecret = Require-EnvironmentVariable "MERCADO_PAGO_WEBHOOK_SECRET"
$melhorEnvioToken = Require-EnvironmentVariable "MELHOR_ENVIO_TOKEN"
$originPostalCode = Require-EnvironmentVariable "MELHOR_ENVIO_ORIGIN_POSTAL_CODE"

$legacyUrl = [Environment]::GetEnvironmentVariable("PIMATA_LEGACY_SUPABASE_URL")
$legacyKey = [Environment]::GetEnvironmentVariable("PIMATA_LEGACY_SUPABASE_ANON_KEY")

$jwtSecret = New-RandomHex
$cookieSecret = New-RandomHex

Write-Host "Criando projeto Railway $ProjectName..."
railway init --name $ProjectName

Write-Host "Provisionando PostgreSQL e Redis dedicados..."
railway add --database postgres --database redis

Write-Host "Criando servicos Medusa server e worker..."
railway add --service pimata-server
railway add --service pimata-worker

foreach ($service in @("pimata-server", "pimata-worker")) {
  railway environment edit --service-config $service source.rootDirectory "/pimata-commerce"
  railway environment edit --service-config $service deploy.restartPolicyType "ON_FAILURE"
}

railway environment edit --service-config pimata-server deploy.healthcheckPath "/health"
railway environment edit --service-config pimata-server deploy.healthcheckTimeout "300"
railway environment edit --service-config pimata-server deploy.startCommand '/bin/sh -c "npm run predeploy && npm run bootstrap && exec npm start"'

$sharedServerVariables = @(
  "NODE_ENV=production",
  "PORT=9000",
  'DATABASE_URL=${{Postgres.DATABASE_URL}}',
  'REDIS_URL=${{Redis.REDIS_URL}}',
  "JWT_SECRET=$jwtSecret",
  "COOKIE_SECRET=$cookieSecret",
  "STORE_CORS=$StorefrontUrl",
  'ADMIN_CORS=https://${{RAILWAY_PUBLIC_DOMAIN}}',
  "AUTH_CORS=$StorefrontUrl," + 'https://${{RAILWAY_PUBLIC_DOMAIN}}',
  'MEDUSA_BACKEND_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}',
  "MERCADO_PAGO_ACCESS_TOKEN=$mpToken",
  "MERCADO_PAGO_WEBHOOK_SECRET=$mpWebhookSecret",
  'MERCADO_PAGO_BACKEND_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}',
  "MERCADO_PAGO_STOREFRONT_URL=$StorefrontUrl",
  "MERCADO_PAGO_STATEMENT_DESCRIPTOR=PIMATA",
  "MELHOR_ENVIO_TOKEN=$melhorEnvioToken",
  "MELHOR_ENVIO_SANDBOX=false",
  "MELHOR_ENVIO_ORIGIN_POSTAL_CODE=$originPostalCode",
  "MELHOR_ENVIO_USER_AGENT=PiMaTa Commerce (contato@pimata.app)",
  "PIMATA_LEGACY_STOREFRONT=$StorefrontUrl",
  "MEDUSA_WORKER_MODE=server",
  "DISABLE_MEDUSA_ADMIN=false"
)

if ($legacyUrl) { $sharedServerVariables += "PIMATA_LEGACY_SUPABASE_URL=$legacyUrl" }
if ($legacyKey) { $sharedServerVariables += "PIMATA_LEGACY_SUPABASE_ANON_KEY=$legacyKey" }

railway variable set --service pimata-server @sharedServerVariables

$workerVariables = @(
  "NODE_ENV=production",
  "PORT=9000",
  'DATABASE_URL=${{Postgres.DATABASE_URL}}',
  'REDIS_URL=${{Redis.REDIS_URL}}',
  "JWT_SECRET=$jwtSecret",
  "COOKIE_SECRET=$cookieSecret",
  "MERCADO_PAGO_ACCESS_TOKEN=$mpToken",
  "MERCADO_PAGO_WEBHOOK_SECRET=$mpWebhookSecret",
  'MERCADO_PAGO_BACKEND_URL=https://${{pimata-server.RAILWAY_PUBLIC_DOMAIN}}',
  "MERCADO_PAGO_STOREFRONT_URL=$StorefrontUrl",
  "MERCADO_PAGO_STATEMENT_DESCRIPTOR=PIMATA",
  "MELHOR_ENVIO_TOKEN=$melhorEnvioToken",
  "MELHOR_ENVIO_SANDBOX=false",
  "MELHOR_ENVIO_ORIGIN_POSTAL_CODE=$originPostalCode",
  "MELHOR_ENVIO_USER_AGENT=PiMaTa Commerce (contato@pimata.app)",
  "PIMATA_LEGACY_STOREFRONT=$StorefrontUrl",
  "MEDUSA_WORKER_MODE=worker",
  "DISABLE_MEDUSA_ADMIN=true"
)

if ($legacyUrl) { $workerVariables += "PIMATA_LEGACY_SUPABASE_URL=$legacyUrl" }
if ($legacyKey) { $workerVariables += "PIMATA_LEGACY_SUPABASE_ANON_KEY=$legacyKey" }

railway variable set --service pimata-worker @workerVariables

Write-Host "Conectando o servidor ao GitHub..."
railway service source connect --repo $Repo --branch $Branch --service pimata-server
railway service pimata-server
$domainOutput = railway domain 2>&1 | Out-String
$serverUrl = ([regex]::Match($domainOutput, 'https?://[^\s]+')).Value.TrimEnd('/')

if ([string]::IsNullOrWhiteSpace($serverUrl)) {
  Write-Host $domainOutput
  throw "Nao foi possivel determinar o dominio Railway do pimata-server. Abra o servico e gere um Railway Domain."
}

Write-Host "Aguardando servidor responder /health..."
$deadline = (Get-Date).AddMinutes(12)
do {
  try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri "$serverUrl/health" -TimeoutSec 15
    if ($health.StatusCode -eq 200 -and $health.Content.Trim() -eq "OK") { break }
  } catch {}
  Start-Sleep -Seconds 10
} while ((Get-Date) -lt $deadline)

if ((Get-Date) -ge $deadline) {
  throw "Servidor nao ficou saudavel dentro do limite. Consulte 'railway logs --service pimata-server'."
}

Write-Host "Servidor saudavel em $serverUrl. Conectando worker..."
railway service source connect --repo $Repo --branch $Branch --service pimata-worker

Write-Host "Executando smoke test de producao..."
Push-Location $PSScriptRoot
try {
  node ./scripts/smoke-production.mjs $serverUrl
} finally {
  Pop-Location
}

Write-Host "Provisionamento concluido."
Write-Host "Backend: $serverUrl"
Write-Host "Admin:   $serverUrl/app"
Write-Host "Webhook Mercado Pago: $serverUrl/hooks/payment/mercadopago_mercadopago"
Write-Host "O dominio venda.pimata.app NAO foi alterado por este script."
