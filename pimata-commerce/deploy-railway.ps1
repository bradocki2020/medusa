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

function Get-RailwayServerUrl {
  $domainOutput = railway domain list --service pimata-server 2>&1 | Out-String
  $urlMatch = [regex]::Match($domainOutput, 'https?://[^\s]+')
  if ($urlMatch.Success) {
    return $urlMatch.Value.TrimEnd('/')
  }

  $hostMatch = [regex]::Match($domainOutput, '[a-zA-Z0-9.-]+\.up\.railway\.app')
  if ($hostMatch.Success) {
    return "https://$($hostMatch.Value)"
  }

  $variablesOutput = railway variable list --service pimata-server --kv 2>&1 | Out-String
  $variableMatch = [regex]::Match($variablesOutput, '(?m)^RAILWAY_PUBLIC_DOMAIN=(.+)$')
  if ($variableMatch.Success) {
    return "https://$($variableMatch.Groups[1].Value.Trim())"
  }

  return ""
}

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Railway CLI e npm nao encontrados. Instale Node.js 22.12+ e execute novamente."
  }
  npm install -g @railway/cli
  if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar Railway CLI." }
}

railway whoami | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Railway nao autenticado. Execute 'railway login' ou conecte o app Railway ao ChatGPT."
}

$existingProject = railway status --json 2>$null | Out-String
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingProject)) {
  throw "Este diretorio ja esta ligado a um projeto Railway. O provisionador cria um projeto novo para evitar duplicar servicos. Use um clone/diretorio limpo ou desvincule com 'railway unlink'."
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
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar projeto Railway." }

Write-Host "Provisionando PostgreSQL e Redis dedicados..."
railway add --database postgres --database redis
if ($LASTEXITCODE -ne 0) { throw "Falha ao provisionar PostgreSQL/Redis." }

Write-Host "Criando servicos Medusa server e worker..."
railway add --service pimata-server
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar pimata-server." }
railway add --service pimata-worker
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar pimata-worker." }

foreach ($service in @("pimata-server", "pimata-worker")) {
  railway environment edit --service-config $service source.rootDirectory "/pimata-commerce"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao configurar root directory de $service." }
  railway environment edit --service-config $service deploy.restartPolicyType "ON_FAILURE"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao configurar restart policy de $service." }
}

railway environment edit --service-config pimata-server deploy.healthcheckPath "/health"
railway environment edit --service-config pimata-server deploy.healthcheckTimeout "300"
railway environment edit --service-config pimata-server deploy.startCommand '/bin/sh -c "npm run predeploy && npm run bootstrap && exec npm start"'

$serverVariables = @(
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

if ($legacyUrl) { $serverVariables += "PIMATA_LEGACY_SUPABASE_URL=$legacyUrl" }
if ($legacyKey) { $serverVariables += "PIMATA_LEGACY_SUPABASE_ANON_KEY=$legacyKey" }
railway variable set --service pimata-server @serverVariables
if ($LASTEXITCODE -ne 0) { throw "Falha ao configurar variaveis do pimata-server." }

Write-Host "Conectando servidor ao GitHub..."
railway service source connect --repo $Repo --branch $Branch --service pimata-server
if ($LASTEXITCODE -ne 0) { throw "Falha ao conectar pimata-server ao GitHub." }

railway domain --service pimata-server | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar dominio do pimata-server." }

$serverUrl = Get-RailwayServerUrl
if ([string]::IsNullOrWhiteSpace($serverUrl)) {
  throw "Nao foi possivel determinar o Railway Domain do pimata-server."
}

Write-Host "Fixando URLs publicas do backend em $serverUrl..."
railway variable set --service pimata-server \
  "MEDUSA_BACKEND_URL=$serverUrl" \
  "MERCADO_PAGO_BACKEND_URL=$serverUrl" \
  "ADMIN_CORS=$serverUrl" \
  "AUTH_CORS=$StorefrontUrl,$serverUrl"
if ($LASTEXITCODE -ne 0) { throw "Falha ao fixar URLs do servidor." }

railway service redeploy --service pimata-server
if ($LASTEXITCODE -ne 0) { throw "Falha ao redeployar pimata-server." }

Write-Host "Aguardando servidor responder /health..."
$deadline = (Get-Date).AddMinutes(12)
$serverHealthy = $false
do {
  try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri "$serverUrl/health" -TimeoutSec 15
    if ($health.StatusCode -eq 200 -and $health.Content.Trim() -eq "OK") {
      $serverHealthy = $true
      break
    }
  } catch {}
  Start-Sleep -Seconds 10
} while ((Get-Date) -lt $deadline)

if (-not $serverHealthy) {
  throw "Servidor nao ficou saudavel dentro do limite. Consulte 'railway logs --service pimata-server'."
}

Write-Host "Servidor saudavel. Configurando worker..."
$workerVariables = @(
  "NODE_ENV=production",
  "PORT=9000",
  'DATABASE_URL=${{Postgres.DATABASE_URL}}',
  'REDIS_URL=${{Redis.REDIS_URL}}',
  "JWT_SECRET=$jwtSecret",
  "COOKIE_SECRET=$cookieSecret",
  "MEDUSA_BACKEND_URL=$serverUrl",
  "MERCADO_PAGO_ACCESS_TOKEN=$mpToken",
  "MERCADO_PAGO_WEBHOOK_SECRET=$mpWebhookSecret",
  "MERCADO_PAGO_BACKEND_URL=$serverUrl",
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
if ($LASTEXITCODE -ne 0) { throw "Falha ao configurar variaveis do pimata-worker." }

railway service source connect --repo $Repo --branch $Branch --service pimata-worker
if ($LASTEXITCODE -ne 0) { throw "Falha ao conectar pimata-worker ao GitHub." }

Write-Host "Executando smoke test de producao..."
Push-Location $PSScriptRoot
try {
  node ./scripts/smoke-production.mjs $serverUrl
  if ($LASTEXITCODE -ne 0) { throw "Smoke test falhou." }
} finally {
  Pop-Location
}

Write-Host "Status atual dos servicos:"
railway service status --all | Out-Host

Write-Host "Provisionamento concluido."
Write-Host "Backend: $serverUrl"
Write-Host "Admin:   $serverUrl/app"
Write-Host "Webhook Mercado Pago: $serverUrl/hooks/payment/mercadopago_mercadopago"
Write-Host "O dominio venda.pimata.app NAO foi alterado por este script."
