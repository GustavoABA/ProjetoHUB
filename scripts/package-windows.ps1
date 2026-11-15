param([string]$Version)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $root
if (-not $Version) { $Version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version }
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'Versão inválida para o pacote Windows.' }
if (-not (Test-Path -LiteralPath 'dist/server/index.js') -or -not (Test-Path -LiteralPath 'dist/client/index.html')) {
  throw 'Execute npm run build antes de empacotar.'
}

$output = Join-Path $root 'release'
$stage = [IO.Path]::GetFullPath((Join-Path $output ".staging-$PID"))
if (-not $stage.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Pasta temporária fora do projeto.' }
$zip = Join-Path $output "ProjetoHUB-v$Version-win-x64.zip"
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
  Copy-Item -LiteralPath 'package.json', 'package-lock.json', 'LICENSE', 'LICENSE-Habblaud', 'INICIAR-PROJETOHUB.cmd', 'RELEASE_NOTES.md' -Destination $stage
  Copy-Item -LiteralPath 'dist' -Destination $stage -Recurse
  New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') | Out-Null
  Copy-Item -LiteralPath 'scripts/start-windows.ps1', 'scripts/autostart-windows.ps1' -Destination (Join-Path $stage 'scripts')
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'node.exe')
  & npm.cmd ci --omit=dev --prefix $stage
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependências de execução.' }
  $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
  if (-not (Test-Path -LiteralPath $compiler)) { throw 'Compilador .NET Framework 4 não encontrado.' }
  & $compiler /nologo /target:exe "/out:$(Join-Path $stage 'ProjetoHUB.exe')" (Join-Path $root 'scripts/ProjetoHUBLauncher.cs')
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o inicializador.' }
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
  if (-not (Test-Path -LiteralPath $zip)) { throw 'ZIP do Windows não foi criado.' }
  Write-Host "Pacote criado: $zip"
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
