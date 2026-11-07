param(
  [switch]$Window,
  [switch]$InstallAutoStart,
  [switch]$RemoveAutoStart,
  [switch]$AutoStartStatus
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if ($InstallAutoStart -or $RemoveAutoStart -or $AutoStartStatus) {
  $action = if ($InstallAutoStart) { 'Install' } elseif ($RemoveAutoStart) { 'Remove' } else { 'Status' }
  & (Join-Path $PSScriptRoot 'autostart-windows.ps1') -Action $action
  exit 0
}

$officePort = if ($env:HABBLAUD_PORT -match '^\d{1,5}$' -and [int]$env:HABBLAUD_PORT -ge 1 -and [int]$env:HABBLAUD_PORT -le 65535) { [int]$env:HABBLAUD_PORT } else { 4747 }
$mcpPort = if ($env:PROJECTHUB_MCP_PORT -match '^\d{1,5}$' -and [int]$env:PROJECTHUB_MCP_PORT -ge 1 -and [int]$env:PROJECTHUB_MCP_PORT -le 65535) { [int]$env:PROJECTHUB_MCP_PORT } else { 4748 }
$officeUrl = "http://127.0.0.1:$officePort"

function Test-Office {
  try {
    $health = Invoke-RestMethod "$officeUrl/api/health" -TimeoutSec 2
    $agents = Invoke-WebRequest "$officeUrl/api/hub/agents" -TimeoutSec 2 -UseBasicParsing
    return $health.ok -eq $true -and $agents.StatusCode -eq 200
  } catch { return $false }
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js 22.12 ou superior não foi encontrado no PATH.' }
$nodeVersion = [version]((& $nodeCommand.Source --version).TrimStart('v'))
if ($nodeVersion -lt [version]'22.12.0') { throw "Node.js $nodeVersion é antigo; instale 22.12 ou superior." }
Write-Host "Node.js $nodeVersion pronto."

foreach ($optional in @('codex.exe', 'docker.exe', 'ngrok.exe')) {
  $found = Get-Command $optional -ErrorAction SilentlyContinue
  if ($found) { Write-Host "$optional encontrado." } else { Write-Host "$optional não está no PATH; recurso opcional." }
}
try {
  $localModels = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2
  Write-Host "Ollama local disponível: $(@($localModels.models).Count) modelo(s)."
} catch { Write-Host 'Ollama local indisponível; o escritório abrirá com os recursos restantes.' }

if (-not (Test-Path -LiteralPath 'node_modules/playwright-core')) {
  Write-Host 'Instalando dependências pela primeira vez...'
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Falha na instalação das dependências.' }
}
$needsBuild = -not (Test-Path -LiteralPath 'dist/server/index.js') -or -not (Test-Path -LiteralPath 'dist/client/index.html') -or -not (Test-Path -LiteralPath 'dist/build.json')
if (-not $needsBuild) {
  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($git) {
    $commit = (& $git.Source rev-parse HEAD 2>$null)
    $changes = (& $git.Source status --porcelain -- server client shared scripts package.json package-lock.json 2>$null)
    try {
      $buildInfo = Get-Content -LiteralPath 'dist/build.json' -Raw | ConvertFrom-Json
      $needsBuild = $buildInfo.commit -ne $commit -or [bool]$changes
    } catch { $needsBuild = $true }
  }
}
if ($needsBuild) {
  Write-Host 'Compilando o escritório...'
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Falha na compilação do escritório.' }
}

if (-not (Test-Office)) {
  $logDir = Join-Path $env:LOCALAPPDATA 'ProjetoHUB/logs'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $server = Start-Process -FilePath $nodeCommand.Source -ArgumentList 'dist/server/index.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "server-$stamp.log") -RedirectStandardError (Join-Path $logDir "server-$stamp.err.log") -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-Office) { $ready = $true; break }
    if ($server.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "O servidor não iniciou. Consulte os logs em $logDir." }
}

try {
  $mcpHealth = Invoke-RestMethod "http://127.0.0.1:$mcpPort/health" -TimeoutSec 2
  if ($mcpHealth.ok -eq $true) { Write-Host "MCP local disponível na porta $mcpPort." }
  else { Write-Host 'MCP local não confirmou a saúde; veja os logs.' }
} catch { Write-Host 'MCP local indisponível; veja os logs do servidor.' }

$edge = Get-Command msedge.exe -ErrorAction SilentlyContinue
if (-not $edge) {
  $candidate = Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'
  if (Test-Path -LiteralPath $candidate) { $edge = @{ Source = $candidate } }
}
if ($edge) {
  $edgeArgs = if ($Window) { @("--app=$officeUrl") } else { @('--start-maximized', "--app=$officeUrl") }
  Start-Process -FilePath $edge.Source -ArgumentList $edgeArgs
} else {
  Start-Process $officeUrl
}
Write-Host "Escritório disponível em $officeUrl"
