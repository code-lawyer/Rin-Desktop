param(
  [Parameter(Mandatory = $true)] [string]$FilePath,
  [string]$Publisher = $env:RIN_RELEASE_SUBJECT
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Publisher)) {
  throw 'Provide the expected code-signing certificate subject with -Publisher or RIN_RELEASE_SUBJECT.'
}

$signature = Get-AuthenticodeSignature -LiteralPath (Resolve-Path -LiteralPath $FilePath).Path
if ($signature.Status -ne 'Valid' -or $signature.SignatureType -ne 'Authenticode' -or -not $signature.TimeStamperCertificate) {
  throw "Expected a valid timestamped Authenticode signature for $FilePath. Windows reported $($signature.Status)."
}
if ($signature.SignerCertificate.Subject -ne $Publisher) {
  throw "Unexpected Authenticode publisher for $FilePath. Windows reported $($signature.SignerCertificate.Subject)."
}
[pscustomobject]@{
  File = Split-Path -Leaf $FilePath
  Publisher = $signature.SignerCertificate.Subject
  Signed = $true
  Timestamped = $true
}
