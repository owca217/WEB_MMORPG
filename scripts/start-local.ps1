param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [int]$Port = 3001
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$postgresRuntime = Join-Path $env:LOCALAPPDATA 'WEB_MMORPG\postgres-runtime'
$previousEnvironment = @{}
foreach ($variableName in @('DATABASE_URL', 'PORT', 'VITE_BASE_PATH', 'VITE_GAME_SERVER_URL')) {
  $previousEnvironment[$variableName] = [Environment]::GetEnvironmentVariable($variableName, 'Process')
}

if (-not $DatabaseUrl) {
  $pgControl = Join-Path $postgresRuntime 'node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe'
  if (-not (Test-Path -LiteralPath $pgControl)) {
    throw 'Provide -DatabaseUrl with a local development PostgreSQL connection string.'
  }
  & $pgControl -D (Join-Path $postgresRuntime 'data') status *> $null
  if ($LASTEXITCODE -ne 0) {
    & $pgControl -D (Join-Path $postgresRuntime 'data') -l (Join-Path $postgresRuntime 'postgres.log') -w start
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the local PostgreSQL database.' }
  }
  $DatabaseUrl = 'postgresql://mmorpg:mmorpg_local_only@127.0.0.1:55432/web_mmorpg_dev'
}

Push-Location $projectDirectory
try {
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  }

  $env:DATABASE_URL = $DatabaseUrl
  $env:PORT = [string]$Port
  $env:VITE_BASE_PATH = '/'
  $env:VITE_GAME_SERVER_URL = ''

  npm.cmd run build --workspace @web-mmorpg/client
  if ($LASTEXITCODE -ne 0) { throw 'Client build failed.' }

  Write-Host "Open http://localhost:$Port/ to play. Press Ctrl+C to stop the game server."
  npm.cmd run start --workspace @web-mmorpg/server
  if ($LASTEXITCODE -ne 0) { throw 'Game server stopped with an error.' }
} finally {
  foreach ($variableName in $previousEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($variableName, $previousEnvironment[$variableName], 'Process')
  }
  Pop-Location
}
