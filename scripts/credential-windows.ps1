param([ValidateSet('Protect', 'Unprotect')][string]$Action)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$value = [Console]::In.ReadToEnd()
if (-not $value -or $value.Length -gt 8192) { throw 'Entrada de credencial inválida.' }
Add-Type -AssemblyName System.Security

if ($Action -eq 'Protect') {
  $bytes = [Text.Encoding]::UTF8.GetBytes($value)
  try {
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Convert]::ToBase64String($encrypted))
  } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
} else {
  $bytes = [Convert]::FromBase64String($value.TrimEnd([char]13, [char]10))
  $decrypted = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($decrypted)) }
  finally { [Array]::Clear($decrypted, 0, $decrypted.Length) }
}
