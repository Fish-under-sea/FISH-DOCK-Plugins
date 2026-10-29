# 可复现构建脚本：magpie Windows amd64。
# 依据 upstream v0.1.1709 的 Makefile release-windows 目标（两段式：launcher .com + 主 exe）。
# 本机无 make，故手写等价流程；本机 Schannel 坏，go 只走 GOPROXY（goproxy.cn），不用 curl/IWR。
#
# 用法：
#   pwsh -File build-magpie.ps1                                  # 干净基线，版本标识跟随 tag v0.1.1709
#   pwsh -File build-magpie.ps1 -VersionTag v0.1.1709+fish.2 -FileVersion 0.1.1709.2 -ProductName "magpie fish"
[CmdletBinding()]
param(
  [string]$VersionTag = 'v0.1.1709',
  [string]$FileVersion = '',
  [string]$ProductName = 'magpie',
  # 自带的 winres.json（带 fish 标记的版本资源）；留空用 upstream 的 build/windows/winres.json
  [string]$WinresJson = '',
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
$T = Split-Path -Parent $PSScriptRoot                    # .work\magpie-build
$Upstream = Join-Path $T 'upstream'
$Goroot = Join-Path $T 'toolchain\go'

$env:GOROOT = $Goroot
$env:PATH = "$Goroot\bin;$env:PATH"
$env:GOPATH = Join-Path $T 'go-path'
$env:GOMODCACHE = Join-Path $env:GOPATH 'pkg\mod'
$env:GOCACHE = Join-Path $T 'go-cache'
$env:GOPROXY = 'https://goproxy.cn,direct'
$env:GOSUMDB = 'sum.golang.org'
$env:GOTOOLCHAIN = 'local'
$env:CGO_ENABLED = '0'
$env:GOOS = 'windows'
$env:GOARCH = 'amd64'

# 四段数字版本：默认由 v0.1.1709 推出 0.1.1709
if (-not $FileVersion) { $FileVersion = ($VersionTag -replace '^v', '' -replace '[^0-9.].*$', '') }
if (-not $Out) { $Out = Join-Path $T 'dist\magpie-windows-amd64.exe' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null

Push-Location $Upstream
try {
  Write-Host "== 1/3 winres（图标 / DPI 清单 / 版本资源）"
  # FileVersion 保持四段数字；产品名/版权等字符串来自 winres json，便于与官方版区分。
  $json = if ($WinresJson) { $WinresJson } else { Join-Path $Upstream 'build\windows\winres.json' }
  & go run github.com/tc-hib/go-winres@v0.3.3 make --in $json --arch amd64 --out rsrc `
    --file-version "$FileVersion" --product-version "$FileVersion"
  if ($LASTEXITCODE -ne 0) { throw "winres 失败（exit $LASTEXITCODE）" }

  Write-Host "== 2/3 launcher .com（终端 magpie 命令的等待器，被主 exe embed）"
  & go build -trimpath -ldflags '-s -w' -o internal/update/launcher-amd64.com ./internal/update/launcher
  if ($LASTEXITCODE -ne 0) { throw "launcher 构建失败（exit $LASTEXITCODE）" }

  Write-Host "== 3/3 主 exe（-tags production,comlauncher，windowsgui）"
  & go build -tags 'production,comlauncher' -trimpath `
    -ldflags "-s -w -X main.version=$VersionTag -H windowsgui" -o $Out .
  if ($LASTEXITCODE -ne 0) { throw "主 exe 构建失败（exit $LASTEXITCODE）" }
}
finally {
  Remove-Item (Join-Path $Upstream 'rsrc_windows_*.syso') -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $Upstream 'internal/update/launcher-*.com') -Force -ErrorAction SilentlyContinue
  Pop-Location
}

$item = Get-Item $Out
$hash = (Get-FileHash $Out -Algorithm SHA256).Hash.ToLower()
Write-Host ""
Write-Host "BUILT  : $($item.FullName)"
Write-Host "BYTES  : $($item.Length)"
Write-Host "MB     : $([math]::Round($item.Length / 1MB, 2))"
Write-Host "SHA256 : $hash"
Write-Host "VER    : $VersionTag / FileVersion=$FileVersion / Product=$ProductName"
[pscustomobject]@{ Path = $item.FullName; Bytes = $item.Length; Sha256 = $hash; Version = $VersionTag; FileVersion = $FileVersion } |
  ConvertTo-Json -Compress | Set-Content (Join-Path (Split-Path -Parent $Out) 'last-build.json') -Encoding utf8
