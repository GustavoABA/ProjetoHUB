param(
  [ValidateSet('Status', 'Install', 'Remove')][string]$Action = 'Status',
  [string]$StartupDirectory
)

$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'start-windows.ps1'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Inicializador do ProjetoHUB não encontrado.' }
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
if (-not $StartupDirectory) { $StartupDirectory = [Environment]::GetFolderPath('Startup') }
if (-not $StartupDirectory) { throw 'Pasta de inicialização do Windows não encontrada.' }
$shortcutPath = Join-Path $StartupDirectory 'ProjetoHUB.lnk'
$shell = New-Object -ComObject WScript.Shell

function Get-ShortcutState {
  if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { return @{ installed = $false; owned = $false } }
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $owned = ([string]::Equals($shortcut.TargetPath, $powershell, [StringComparison]::OrdinalIgnoreCase) -and $shortcut.Arguments -eq $arguments)
  return @{ installed = $true; owned = $owned }
}

$state = Get-ShortcutState
switch ($Action) {
  'Install' {
    if ($state.installed -and -not $state.owned) { throw 'Já existe um atalho ProjetoHUB.lnk que não pertence a esta instalação.' }
    if (-not $state.installed) {
      New-Item -ItemType Directory -Path $StartupDirectory -Force | Out-Null
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = $powershell
      $shortcut.Arguments = $arguments
      $shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
      $shortcut.Description = 'Iniciar o escritório ProjetoHUB ao entrar no Windows'
      $shortcut.Save()
    }
  }
  'Remove' {
    if ($state.installed -and -not $state.owned) { throw 'O atalho ProjetoHUB.lnk existente não pertence a esta instalação.' }
    if ($state.installed) { Remove-Item -LiteralPath $shortcutPath }
  }
}
$state = Get-ShortcutState
@{ installed = $state.installed; owned = $state.owned; shortcut = $shortcutPath } | ConvertTo-Json -Compress
