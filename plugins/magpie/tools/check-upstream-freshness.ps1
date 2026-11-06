<#
.SYNOPSIS
  落后闸门：发版前检查补丁链的基线离上游最新有多远（#31 第二节第 5 条）。

.DESCRIPTION
  判据（两项任一满足即算新鲜，两项都超才算落后）：
    · 记录的基线是 ≤ MaxHours 小时内抓的；
    · 基线之后上游只多了 ≤ MaxTags 个 tag。
  超了就退出码 2 并把差距打出来——发布脚本据此拒绝打包。

  离线可复现：-LatestTag 覆盖上游最新 tag，-Now 覆盖“现在”，
  这样验收用的假记录不需要联网也能跑出确定结果。

.EXAMPLE
  pwsh check-upstream-freshness.ps1                 # 看现状
  pwsh check-upstream-freshness.ps1 -RequireLatest  # 跟不上就 exit 2

.EXAMPLE
  # 验收演练：伪造一份「落后 30 个 tag、3 天前抓的」记录 → 必须拒绝
  pwsh check-upstream-freshness.ps1 -Record .work/fake-behind.json -LatestTag v0.1.3140 -RequireLatest
#>
[CmdletBinding()]
param(
  # upstream.json 的位置，默认本插件 patches 目录下那份
  [string]$Record = '',
  [string]$Owner = 'yetone',
  [string]$Repo = 'magpie',
  # 记录超过这么多小时算过期
  [int]$MaxHours = 24,
  # 上游多了这么多 tag 算落后
  [int]$MaxTags = 10,
  # 离线覆盖：不传就从 gh api 取
  [string]$LatestTag = '',
  # 离线覆盖：不传就是现在
  [string]$Now = '',
  # 跟不上就 exit 2（发布链路用这个）
  [switch]$RequireLatest,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

if (-not $Record) {
  $Record = Join-Path (Split-Path -Parent $PSScriptRoot) 'patches\upstream.json'
}

function Say($m, $color = '') { if (-not $Quiet) { if ($color) { Write-Host $m -ForegroundColor $color } else { Write-Host $m } } }

# tag → 数字序号：v0.1.3140 → 3140。只认 v<major>.<minor>.<patch> 这一种形状，
# 上游就是这么发的；认不出来退回 0 并说明，不猜。
function TagNumber([string]$tag) {
  if ($tag -match '^v?(\d+)\.(\d+)\.(\d+)') {
    return [long]$Matches[1] * 1000000 + [long]$Matches[2] * 1000 + [long]$Matches[3]
  }
  return $null
}

if (-not (Test-Path $Record)) {
  Write-Host "没有基线记录：$Record（先跑 tools/follow-upstream.ps1）" -ForegroundColor Red
  exit 3
}
$rec = Get-Content $Record -Raw | ConvertFrom-Json
$baseTag = $rec.baseTag
$fetchedAt = $rec.fetchedAt
if (-not $baseTag) {
  Write-Host "记录里没有 baseTag：$Record" -ForegroundColor Red
  exit 3
}

# 上游最新 tag：先看过的就用，否则现场取（不读缓存，缓存本身可能就是旧的）
if (-not $LatestTag) {
  $json = gh api "repos/$Owner/$Repo/tags?per_page=100" 2>$null | Out-String
  if ($LASTEXITCODE -ne 0 -or -not $json.Trim()) {
    Write-Host "取不到上游 tag 列表（gh api 失败）——闸门没法判定，按未通过处理" -ForegroundColor Yellow
    if ($RequireLatest) { exit 3 } else { exit 0 }
  }
  $tags = ($json | ConvertFrom-Json) | ForEach-Object { $_.name }
  $LatestTag = $tags | Sort-Object { TagNumber $_ } | Select-Object -Last 1
}

$clockNow = if ($Now) { [datetimeoffset]::Parse($Now) } else { [datetimeoffset]::Now }
# 注意：局部变量不能叫 $now——PowerShell 变量名不区分大小写，那会和参数 $Now
# 撞名，赋值时又被转回 [string]（踩过一次）。
$recordedAt = if ($fetchedAt) { [datetimeoffset]::Parse($fetchedAt) } else { [datetimeoffset]::MinValue }
$ageHours = [math]::Round(($clockNow - $recordedAt).TotalHours, 1)

$baseNum = TagNumber $baseTag
$lastNum = TagNumber $LatestTag
$tagGap = if ($null -ne $baseNum -and $null -ne $lastNum) { [long]($lastNum - $baseNum) } else { $null }

Say ''
Say '── 上游落后闸门 ────────────────────────────────'
Say ("  基线      {0}（{1} 抓的，{2} 小时前）" -f $baseTag, $(if ($fetchedAt) { ([datetimeoffset]::Parse($fetchedAt)).ToLocalTime().ToString('MM-dd HH:mm') } else { '?' }), $ageHours)
Say ("  上游最新  {0}" -f $LatestTag)
if ($null -ne $tagGap) {
  Say ("  落后      {0} 个 tag" -f $tagGap)
} else {
  Say '  落后      tag 形状认不出，只按时间判'
}
Say ("  判据      ≤{0} 小时  或  ≤{1} 个 tag（两项都超才算落后）" -f $MaxHours, $MaxTags)

$tooOld = $ageHours -gt $MaxHours
$tooMany = ($null -ne $tagGap) -and ($tagGap -gt $MaxTags)
$stale = $tooOld -and $tooMany

if (-not $stale) {
  $why = @()
  if (-not $tooOld) { $why += ("{0}h ≤ {1}h" -f $ageHours, $MaxHours) }
  if ($null -ne $tagGap -and -not $tooMany) { $why += ("{0} tag ≤ {1} tag" -f $tagGap, $MaxTags) }
  Say (("  结论      新鲜（{0}）" -f ($why -join '，'))) 'Green'
  Say ''
  exit 0
}

Write-Host ''
Write-Host (("  结论      落后：{0} 小时前抓的基线，上游已多 {1} 个 tag" -f $ageHours, $tagGap)) -ForegroundColor Red
Write-Host '            先跑 tools/follow-upstream.ps1 追平，再打包发版。' -ForegroundColor Red
Write-Host ''
if ($RequireLatest) { exit 2 }
exit 0