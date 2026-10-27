param(
 [Parameter(Mandatory=$true)][string]$Sdk,
 [Parameter(Mandatory=$true)][string]$Ofm,
 [Parameter(Mandatory=$true)][string]$Magpie,
 [Parameter(Mandatory=$true)][string]$Mihomo,
 [Parameter(Mandatory=$true)][string]$Out,
 [string]$Version = '1.0.2'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$target = [System.IO.Path]::GetFullPath($Out)
if (Test-Path -LiteralPath $target) { throw '输出目录已存在，请选择新的本地实验目录。' }
foreach ($inputPath in @($Sdk, $Ofm, $Magpie, $Mihomo)) {
 if (-not [System.IO.Path]::IsPathFullyQualified($inputPath)) { throw '输入路径必须是绝对路径。' }
 if (-not (Test-Path -LiteralPath $inputPath)) { throw "缺少构建输入：$inputPath" }
}
$release = Join-Path $target 'release'
$npm = Join-Path $target 'npm'
New-Item -ItemType Directory -Path $target | Out-Null
Push-Location $repo
try {
 & node tools/build-release.mjs --out $release --sdk $Sdk --ofm $Ofm --magpie $Magpie --mihomo $Mihomo --version $Version
 if ($LASTEXITCODE -ne 0) { throw '本地插件构建失败；保留输出用于诊断。' }
 & node tools/build-npm-packages.mjs --dist (Join-Path $release 'dist') --out $npm --version $Version
 if ($LASTEXITCODE -ne 0) { throw '本地 npm 目录构建失败。' }
 $report = & node tools/verify-release.mjs --dist (Join-Path $release 'dist') --npm $npm
 if ($LASTEXITCODE -ne 0) { throw '本地归档核验失败。' }
 $report | Set-Content -LiteralPath (Join-Path $target 'artifact-verification.json') -Encoding utf8
 $inputs = [ordered]@{
  scope = 'local-only'
  generatedAt = (Get-Date).ToString('o')
  version = $Version
  node = (& node --version)
  sdk = $Sdk
  ofm = $Ofm
  magpie = @{ path = $Magpie; sha256 = (Get-FileHash -LiteralPath $Magpie -Algorithm SHA256).Hash.ToLowerInvariant() }
  mihomo = @{ path = $Mihomo; sha256 = (Get-FileHash -LiteralPath $Mihomo -Algorithm SHA256).Hash.ToLowerInvariant() }
  sdkBackendSha256 = (Get-FileHash -LiteralPath (Join-Path $Sdk 'node/plugin.mjs') -Algorithm SHA256).Hash.ToLowerInvariant()
 }
 $inputs | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $target 'build-inputs.json') -Encoding utf8
 $report
 Write-Output "仅生成本地文件，未上传或发布。输出：$target"
} finally {
 Pop-Location
}
