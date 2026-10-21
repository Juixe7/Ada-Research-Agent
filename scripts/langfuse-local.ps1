param(
    [ValidateSet("up", "down", "status", "logs")]
    [string]$Action = "up"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$localDir = Join-Path $repoRoot ".local-run\langfuse"
$composeFile = Join-Path $localDir "docker-compose.yml"
$localEnv = Join-Path $localDir ".env"
$appEnv = Join-Path $repoRoot ".env"

function Set-EnvValue([string]$Path, [string]$Name, [string]$Value) {
    $content = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw } else { "" }
    $pattern = "(?m)^\s*" + [regex]::Escape($Name) + "\s*=.*$"
    $line = "$Name=$Value"
    if ([regex]::IsMatch($content, $pattern)) {
        $content = [regex]::Replace($content, $pattern, $line)
    } else {
        $content = $content.TrimEnd() + "`n" + $line + "`n"
    }
    [System.IO.File]::WriteAllText($Path, $content.TrimEnd() + "`n", [System.Text.UTF8Encoding]::new($false))
}

function New-Secret([int]$Bytes = 32) {
    $buffer = [byte[]]::new($Bytes)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

function Prepare-LocalCompose {
    if (-not (Test-Path -LiteralPath $composeFile)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $localDir) | Out-Null
        & git -c core.longpaths=true clone --depth 1 --filter=blob:none --sparse https://github.com/langfuse/langfuse.git $localDir
        if ($LASTEXITCODE -ne 0) { throw "Could not clone the official Langfuse repository." }
        & git -C $localDir sparse-checkout set docker-compose.yml
        if ($LASTEXITCODE -ne 0) { throw "Could not check out Langfuse's Docker Compose file." }
    }

    $compose = Get-Content -LiteralPath $composeFile -Raw
    $portMappings = @(
        @{ Pattern = '(?m)^    ports:\r?\n      - 127\.0\.0\.1:3030:3030\r?\n'; Replacement = '' },
        @{ Pattern = '(?m)^    ports:\r?\n      - 3000:3000\r?\n'; Replacement = "    ports:`n      - 127.0.0.1:3002:3000`n" },
        @{ Pattern = '(?m)^    ports:\r?\n      - 127\.0\.0\.1:8123:8123\r?\n      - 127\.0\.0\.1:9000:9000\r?\n'; Replacement = '' },
        @{ Pattern = '(?m)^    ports:\r?\n      - 9090:9000\r?\n      - 127\.0\.0\.1:9091:9001\r?\n'; Replacement = "    ports:`n      - 127.0.0.1:9094:9000`n      - 127.0.0.1:9095:9001`n" },
        @{ Pattern = '(?m)^      - 127\.0\.0\.1:9092:9000\r?\n      - 127\.0\.0\.1:9093:9001\r?\n'; Replacement = "      - 127.0.0.1:9094:9000`n      - 127.0.0.1:9095:9001`n" },
        @{ Pattern = '(?m)^    ports:\r?\n      - 127\.0\.0\.1:6379:6379\r?\n'; Replacement = '' },
        @{ Pattern = '(?m)^    ports:\r?\n      - 127\.0\.0\.1:5432:5432\r?\n'; Replacement = '' }
    )
    foreach ($mapping in $portMappings) {
        $compose = [regex]::Replace($compose, $mapping.Pattern, $mapping.Replacement)
    }
    if ($compose -notmatch '127\.0\.0\.1:3002:3000' -or $compose -match '(^|\s)(3000:3000|9090:9000|127\.0\.0\.1:5432:5432|127\.0\.0\.1:6379:6379)(\s|$)') {
        throw "Langfuse Compose ports did not match the expected local setup; review the upstream compose file before starting it."
    }
    [System.IO.File]::WriteAllText($composeFile, $compose, [System.Text.UTF8Encoding]::new($false))

    if (-not (Test-Path -LiteralPath $localEnv)) {
        $postgresPassword = New-Secret
        $clickhousePassword = New-Secret
        $redisPassword = New-Secret
        $minioPassword = New-Secret
        $settings = [ordered]@{
            NEXTAUTH_URL = "http://localhost:3002"
            NEXTAUTH_SECRET = New-Secret 48
            SALT = New-Secret
            ENCRYPTION_KEY = New-Secret
            POSTGRES_USER = "postgres"
            POSTGRES_PASSWORD = $postgresPassword
            POSTGRES_DB = "postgres"
            DATABASE_URL = "postgresql://postgres:$postgresPassword@postgres:5432/postgres"
            CLICKHOUSE_USER = "clickhouse"
            CLICKHOUSE_PASSWORD = $clickhousePassword
            CLICKHOUSE_MIGRATION_URL = "clickhouse://clickhouse:$clickhousePassword@clickhouse:9000"
            CLICKHOUSE_URL = "http://clickhouse:8123"
            REDIS_AUTH = $redisPassword
            MINIO_ROOT_USER = "langfuse-local"
            MINIO_ROOT_PASSWORD = $minioPassword
            LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID = "langfuse-local"
            LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY = $minioPassword
            LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT = "http://minio:9000"
            LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID = "langfuse-local"
            LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY = $minioPassword
            LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT = "http://localhost:9094"
            LANGFUSE_S3_MEDIA_UPLOAD_INTERNAL_ENDPOINT = "http://minio:9000"
        }
        $settings.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value } |
            Set-Content -LiteralPath $localEnv -Encoding utf8
    }

    if (-not (Test-Path -LiteralPath $appEnv)) {
        throw "Create the Ada root .env from .env.example before enabling local Langfuse."
    }
    Set-EnvValue -Path $appEnv -Name "LANGFUSE_ENABLED" -Value "true"
    Set-EnvValue -Path $appEnv -Name "LANGFUSE_BASE_URL" -Value "http://localhost:3002"
}

if ($Action -eq "up") { Prepare-LocalCompose }
if (-not (Test-Path -LiteralPath $composeFile)) {
    throw "Langfuse is not set up yet. Run this script with the 'up' action first."
}

$composeArgs = @("compose", "--project-directory", $localDir, "-f", $composeFile)
switch ($Action) {
    "up" { & docker @composeArgs up -d }
    "down" { & docker @composeArgs down }
    "status" { & docker @composeArgs ps }
    "logs" { & docker @composeArgs logs -f --tail=100 }
}
if ($LASTEXITCODE -ne 0) { throw "Langfuse Docker Compose action '$Action' failed." }
if ($Action -eq "up") {
    Write-Host "Langfuse is starting at http://localhost:3002. Create a project and add its API keys to Ada's ignored .env before expecting traces."
}
