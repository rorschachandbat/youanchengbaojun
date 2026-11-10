# 仅上传地图和卡图，不构建、不切换 release、不重启服务。
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$KeyPath,
    [string]$User = "root",
    [int]$SshPort = 22,
    [string]$InstallRoot = "/opt/tyrants",
    [switch]$OriginalJpeg
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$key = (Resolve-Path -LiteralPath $KeyPath).Path
if ($Server -notmatch '^[a-zA-Z0-9.-]+$' -or $User -notmatch '^[a-zA-Z0-9_-]+$') { throw "无效的 SSH 地址" }
if ($InstallRoot -notmatch '^/opt/[a-zA-Z0-9_-]+$') { throw "无效的远程安装路径" }
if ($SshPort -lt 1 -or $SshPort -gt 65535) { throw "端口超出范围" }
$assets = Join-Path $root "assets"
if ($OriginalJpeg) {
    # 兼容仍运行旧版前端的 release；新版本默认使用内容哈希命名的 WebP。
    $cards = Get-Content -Raw -LiteralPath (Join-Path $assets "card-data.json") | ConvertFrom-Json
    $paths = @("board/map.jpg") + @($cards.PSObject.Properties.Value.image | ForEach-Object { $_ -replace '^assets/', '' } | Sort-Object -Unique)
    $folders = "cards board"
} else {
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $root "src/server-image-manifest.json") | ConvertFrom-Json
    $paths = @($manifest.images.PSObject.Properties.Value.file | Sort-Object -Unique)
    $folders = "media"
}
$lines = foreach ($relative in $paths) {
    if ($relative -notmatch '^(media/[a-f0-9]{64}\.webp|board/map\.jpg|cards/[a-z0-9-]+/[a-z0-9-]+\.jpg)$') { throw "无效的图片路径：$relative" }
    $file = Join-Path $assets $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "缺少图片：$relative，请先运行 npm run preload:images。" }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $relative"
}
$id = [Guid]::NewGuid().ToString("N")
$temporary = Join-Path ([IO.Path]::GetTempPath()) "tyrants-images-$id"
$archive = "$temporary.tar.gz"
$remote = "/tmp/tyrants-images-$id"
$target = "${User}@${Server}"
$sshArgs = @("-i", $key, "-p", "$SshPort", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15")
$scpArgs = @("-i", $key, "-P", "$SshPort", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15")
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    # 清单仅含图片哈希和相对路径，服务器先校验，绝不上传图床原图、源码或凭证。
    [IO.File]::WriteAllText((Join-Path $temporary "IMAGE-SHA256SUMS"), ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $temporary "FILELIST"), ($paths -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
    & tar.exe -czf $archive -C $assets -T (Join-Path $temporary "FILELIST") -C $temporary IMAGE-SHA256SUMS
    if ($LASTEXITCODE -ne 0) { throw "图片打包失败" }
    & scp.exe @scpArgs $archive "${target}:${remote}.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw "图片上传失败" }
    # 验证 current 位于本项目 releases 内；只添加静态图片，不触及服务和对局。
    $command = "set -eu; current=`$(readlink -f '$InstallRoot/current'); case `"`$current`" in '$InstallRoot'/releases/*) ;; *) echo 'Invalid current release' >&2; exit 1;; esac; test -s `"`$current/server-dist/standalone.mjs`"; mkdir '$remote'; tar -xzf '$remote.tar.gz' -C '$remote'; cd '$remote'; sha256sum -c IMAGE-SHA256SUMS >/dev/null; for folder in $folders; do mkdir -p `"`$current/dist/`$folder`"; cp -a `"`$folder/.`" `"`$current/dist/`$folder/`"; chmod -R a+rX `"`$current/dist/`$folder`"; done; cp IMAGE-SHA256SUMS `"`$current/dist/IMAGE-SHA256SUMS`"; cd `"`$current/dist`"; sha256sum -c IMAGE-SHA256SUMS >/dev/null; echo `"Verified $($paths.Count) images in `$current/dist; service was not restarted.`"; rm -f '$remote.tar.gz'"
    & ssh.exe @sshArgs $target $command
    if ($LASTEXITCODE -ne 0) { throw "服务器图片安装或哈希校验失败" }
} finally {
    # 仅删除本次生成的三个确定临时文件；不递归删除工作目录。
    foreach ($file in @($archive, (Join-Path $temporary "IMAGE-SHA256SUMS"), (Join-Path $temporary "FILELIST"))) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
    Remove-Item -LiteralPath $temporary
}
