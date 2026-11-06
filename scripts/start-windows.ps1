param([switch]$Window)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Test-Office {
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:4747/api/health' -TimeoutSec 2
    return $health.ok -eq $true
  } catch { return $false }
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js 22.12 ou superior não foi encontrado no PATH.' }
$nodeVersion = [version]((& $nodeCommand.Source --version).TrimStart('v'))
if ($nodeVersion -lt [version]'22.12.0') { throw "Node.js $nodeVersion é antigo; instale 22.12 ou superior." }

if (-not (Test-Path -LiteralPath 'node_modules')) {
  Write-Host 'Instalando dependências pela primeira vez...'
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Falha na instalação das dependências.' }
}
if (-not (Test-Path -LiteralPath 'dist/server/index.js') -or -not (Test-Path -LiteralPath 'dist/client/index.html')) {
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

$edge = Get-Command msedge.exe -ErrorAction SilentlyContinue
if (-not $edge) {
  $candidate = Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'
  if (Test-Path -LiteralPath $candidate) { $edge = @{ Source = $candidate } }
}
if ($edge) {
  $edgeArgs = if ($Window) { @('--app=http://127.0.0.1:4747') } else { @('--start-maximized', '--app=http://127.0.0.1:4747') }
  Start-Process -FilePath $edge.Source -ArgumentList $edgeArgs
} else {
  Start-Process 'http://127.0.0.1:4747'
}
Write-Host 'Escritório disponível em http://127.0.0.1:4747'
