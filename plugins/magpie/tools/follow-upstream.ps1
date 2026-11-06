# 跟随上游 magpie：解析最新 tag → 取源码 → 重放我们的补丁 → 出冲突清单。
#
# 上游是 24h loop（忙时一小时好几个 tag），所以**基线一律由脚本解析，不写死**：
# 仓库里任何「当前基线是 vX」的常量都会过期，第 -Tag 参数只是临时覆盖用。
#
# 用法：
#   pwsh -File follow-upstream.ps1                     # 解析最新 tag，诊断式重放（默认）
#   pwsh -File follow-upstream.ps1 -Tag v0.1.3136       # 指定 tag
#   pwsh -File follow-upstream.ps1 -Clean               # 诊断后把工作树还原成干净基线
#   pwsh -File follow-upstream.ps1 -Patch ..\patches\magpie-v0.1.2799+fish.15.patch
#
# 退出码：0 = 补丁干净应用；2 = 有冲突（需要人工决定那几处）；1 = 其它失败。
#
# 产物：
#   <构建根>/magpie-<tag>/            上游源码（git 基线 + 重放结果；有冲突时留 .rej）
#   <构建根>/magpie-<tag>.tar.gz      源码包（断点续传，重复跑不重下）
#   plugins/magpie/patches/upstream.json  生成物：基线 tag / sha / 抓取时间 / 补丁名 / exe 版本串 / 冲突清单
[CmdletBinding()]
param(
  [string]$Tag = '',
  [string]$Patch = '',
  [string]$BuildRoot = '',
  [string]$Owner = 'yetone',
  [string]$Repo = 'magpie',
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$tools = $PSScriptRoot
$plugin = Split-Path -Parent $tools
$repoRoot = Split-Path -Parent $plugin
$patches = Join-Path $plugin 'patches'
if (-not $BuildRoot) { $BuildRoot = Join-Path (Split-Path -Parent $repoRoot) '.work\magpie-build' }
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
New-Item -ItemType Directory -Force $BuildRoot | Out-Null

function Say([string]$text) { Write-Host $text }

# ── 1. 解析基线 tag ────────────────────────────────────────────────────────
# 取 tag 列表的第一个（GitHub 按创建的 tag 时间倒序），再用数字比较兜一层：
# 上游 tag 形如 v0.1.3136，逐段比大小即可，别信「看起来像最新」。
function Resolve-LatestTag {
  $json = gh api "repos/$Owner/$Repo/tags?per_page=100" 2>$null
  if (-not $json) { throw '读不到上游 tag 列表（gh api 失败）' }
  $names = ($json | ConvertFrom-Json) | ForEach-Object { $_.name }
  $best = $null; $bestKey = $null
  foreach ($name in $names) {
    if ($name -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { continue }
    $key = [version]("$($Matches[1]).$($Matches[2]).$($Matches[3])")
    if ($null -eq $bestKey -or $key -gt $bestKey) { $bestKey = $key; $best = $name }
  }
  if (-not $best) { throw '上游 tag 列表里没有可解析的版本号' }
  return $best
}

function Resolve-Patch([string]$dir) {
  $files = Get-ChildItem $dir -Filter 'magpie-v*+fish.*.patch' -File
  if (-not $files) { throw "没有找到补丁：$dir" }
  # 按 fish 序号取最大，同一序号取最后写入的那个。
  $best = $null; $bestN = -1
  foreach ($f in $files) {
    if ($f.Name -notmatch '\+fish\.(\d+)\.patch$') { continue }
    $n = [int]$Matches[1]
    if ($n -gt $bestN) { $bestN = $n; $best = $f }
  }
  if (-not $best) { throw "补丁名里没有 fish 序号：$dir" }
  return @{ File = $best.FullName; Name = $best.Name; Fish = $bestN }
}

if (-not $Tag) {
  $Tag = Resolve-LatestTag
  Say "基线：解析到上游最新 tag $Tag（未写死）"
} else {
  Say "基线：显式指定 $Tag"
}

if (-not $Patch) {
  $p = Resolve-Patch $patches
  $Patch = $p.File
  $fish = $p.Fish
  Say "补丁：$($p.Name)（+fish.$fish）"
} else {
  $Patch = (Resolve-Path $Patch).Path
  $fish = if ($Patch -match '\+fish\.(\d+)\.patch$') { [int]$Matches[1] } else { throw '补丁名里没有 fish 序号' }
  Say "补丁：$(Split-Path -Leaf $Patch)"
}

$tagVersion = $Tag -replace '^v', ''            # 0.1.3136
$fishNext = $fish + 1
$versionTag = "v$tagVersion+fish.$fishNext"     # 打补丁后的版本串
$fileVersion = "$tagVersion.$fishNext"          # 0.1.3136.16
Say "产物版本：$versionTag / FileVersion=$fileVersion"

# ── 2. 取源码（断点续传，重复跑不重下）──────────────────────────────────────
$tarball = Join-Path $BuildRoot "$Repo-$Tag.tar.gz"
$srcDir = Join-Path $BuildRoot "$Repo-$tagVersion"
if (-not (Test-Path $tarball) -or (Get-Item $tarball).Length -lt 1MB) {
  $url = "https://codeload.github.com/$Owner/$Repo/tar.gz/refs/tags/$Tag"
  Say "下载：$url"
  # 本机 schannel 坏，用 python 的 OpenSSL 栈并支持 Range 续传。
  $py = @"
import os, time, urllib.request
DST = r'$tarball'
SRC = r'$url'
def have(): return os.path.getsize(DST) if os.path.exists(DST) else 0
for attempt in range(120):
    got = have()
    req = urllib.request.Request(SRC, headers={'User-Agent': 'fish-dock', 'Range': 'bytes=%d-' % got})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            with open(DST, 'ab' if got else 'wb') as f:
                while True:
                    c = r.read(1 << 20)
                    if not c: break
                    f.write(c)
        break
    except Exception as e:
        print('  retry at %d: %s' % (have(), type(e).__name__), flush=True)
        time.sleep(2)
print('size', have())
"@
  $pyFile = Join-Path $BuildRoot 'fetch-upstream.py'
  Set-Content $pyFile -Value $py -NoNewline -Encoding UTF8
  $python = (Get-Command python -ErrorAction SilentlyContinue)?.Source
  if (-not $python) {
    $cand = 'C:\Users\Fish\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\python\python.exe'
    if (Test-Path $cand) { $python = $cand } else { throw '找不到 python（下载走它，因为本机 schannel 坏）' }
  }
  & $python $pyFile | Out-Null
  if ((Get-Item $tarball).Length -lt 1MB) { throw "下载失败：$tarball" }
}

if (-not (Test-Path $srcDir)) {
  Say "解包：$tarball"
  $stage = Join-Path $BuildRoot "_stage"
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $stage | Out-Null
  tar -xzf $tarball -C $stage
  $inner = Get-ChildItem $stage -Directory | Select-Object -First 1
  if (-not $inner) { throw '解包后没有目录' }
  Move-Item $inner.FullName $srcDir
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

# ── 3. git 基线（3-way / .rej 都要有 index）─────────────────────────────────
Push-Location $srcDir
try {
  if (-not (Test-Path (Join-Path $srcDir '.git'))) {
    Say '建立 git 基线（上游 tag 的原始状态）'
    git init -q | Out-Null
    git config core.longpaths true
    # 上游 testdata 里有超长路径，Windows 必须开 longpaths 才加得进 index。
    git -c core.longpaths=true -c user.name=fish -c user.email=fish@local add -A 2>$null | Out-Null
    git -c core.longpaths=true -c user.name=fish -c user.email=fish@local commit -qm "upstream $Tag" 2>$null | Out-Null
  }

  # ── 4. 重放补丁 ──────────────────────────────────────────────────────────
  $dirty = (git status --porcelain | Measure-Object).Count
  if ($dirty -gt 0) {
    Say "工作树有 $dirty 项改动（上次重放的残留）：还原后再来"
    git checkout -- . | Out-Null
    git clean -fdq | Out-Null
  }

  Say '检查能否干净应用…'
  git -c core.longpaths=true apply --check "$Patch" 2>$null | Out-Null
  $cleanApply = ($LASTEXITCODE -eq 0)

  $conflicts = @()
  if ($cleanApply) {
    Say '  干净应用，无冲突'
    git -c core.longpaths=true apply --whitespace=nowarn "$Patch" | Out-Null
  } else {
    Say '  有冲突，按文件产出 .rej（不清屏，方便逐条看）'
    git -c core.longpaths=true apply --reject --whitespace=nowarn "$Patch" 2>&1 | Out-Null
    $conflicts = Get-ChildItem -Recurse -Filter '*.rej' -ErrorAction SilentlyContinue | ForEach-Object {
      $rel = $_.FullName.Substring($srcDir.Length).TrimStart('\', '/') -replace '\.rej$', '' -replace '\\', '/'
      [pscustomobject]@{
        file  = $rel
        hunks = (Select-String -Path $_.FullName -Pattern '^@@' | Measure-Object).Count
      }
    }
    $conflicts = @($conflicts | Sort-Object file)
  }

  $totalHunks = (Select-String -Path $Patch -Pattern '^@@' | Measure-Object).Count
  $totalFiles = (Select-String -Path $Patch -Pattern '^diff --git ' | Measure-Object).Count
  $failedHunks = ($conflicts | Measure-Object -Property hunks -Sum).Sum
  if (-not $failedHunks) { $failedHunks = 0 }

  # ── 5. 冲突分档 ──────────────────────────────────────────────────────────
  # 小冲突 = 只有预算常量、版本串、i18n 文案、文档这类「按规则改成实测值」的；
  # 其余（业务代码结构变了）一律算大冲突，停下交人工，不静默跳过。
  $minor = @()
  $major = @()
  foreach ($c in $conflicts) {
    $isMinor = $c.file -match '(^|/)core_budget_test\.go$' -or
               $c.file -match '(^|/)i18n\.js$' -or
               $c.file -match '\.md$' -or
               $c.file -match '(^|/)winres\.json$'
    if ($isMinor) { $minor += $c } else { $major += $c }
  }

  Say ''
  Say '── 重放结果 ─────────────────────────────────────────'
  Say ("补丁 {0}：{1} 个文件 / {2} 个 hunk" -f (Split-Path -Leaf $Patch), $totalFiles, $totalHunks)
  Say ("干净应用：{0} 个文件 / {1} 个 hunk" -f ($totalFiles - $conflicts.Count), ($totalHunks - $failedHunks))
  Say ("冲突：{0} 个文件 / {1} 个 hunk（小冲突 {2}，大冲突 {3}）" -f $conflicts.Count, $failedHunks, $minor.Count, $major.Count)
  if ($conflicts.Count) {
    Say ''
    foreach ($c in $major) { Say ("  [大] {0}  {1} hunk" -f $c.file, $c.hunks) }
    foreach ($c in $minor) { Say ("  [小] {0}  {1} hunk" -f $c.file, $c.hunks) }
    Say ''
    Say "冲突原文在：$srcDir（每个冲突文件旁边有同名 .rej）"
  }

  # ── 6. 记录基线（生成物，不手维护）───────────────────────────────────────
  $sha = (gh api "repos/$Owner/$Repo/git/refs/tags/$Tag" --jq '.object.sha' 2>$null)
  if (-not $sha) { $sha = '' }
  $record = [ordered]@{
    schema     = 1
    upstream   = "$Owner/$Repo"
    baseTag    = $Tag
    baseSha    = $sha.Trim()
    fetchedAt  = (Get-Date).ToString('o')
    patch      = Split-Path -Leaf $Patch
    versionTag = $versionTag
    fileVersion= $fileVersion
    product    = 'magpie fish'
    result     = if ($conflicts.Count) { 'conflicts' } else { 'clean' }
    counts     = [ordered]@{
      files        = $totalFiles
      hunks        = $totalHunks
      appliedFiles = $totalFiles - $conflicts.Count
      appliedHunks = [int]($totalHunks - $failedHunks)
      conflictFiles= $conflicts.Count
      conflictHunks= [int]$failedHunks
    }
    conflicts  = @($conflicts)
  }
  $recordPath = Join-Path $patches 'upstream.json'
  Set-Content $recordPath -Value (($record | ConvertTo-Json -Depth 6) + "`n") -NoNewline -Encoding UTF8
  Say ''
  Say "基线记录：$recordPath"

  if ($Clean) {
    Say '还原工作树（-Clean）'
    git checkout -- . | Out-Null
    git clean -fdq | Out-Null
  }

  if ($conflicts.Count) {
    Say ''
    Say '有冲突：先按上面的清单处理（大冲突要人工决定），再重跑本脚本确认无冲突。'
    exit 2
  }
  Say ''
  Say "无冲突：可以直接编译 → $versionTag（FileVersion=$fileVersion）"
  exit 0
} finally {
  Pop-Location
}
