# 仅上传已有构建产物；如需构建，由调用者先明确执行 npm run build:friends。
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$KeyPath,
    [string]$User = "root",
    [int]$SshPort = 22,
    [int]$ControlPort = 8080,
    [string]$InstallRoot = "/opt/tyrants",
    [string]$NodeBin = "/usr/bin/node"
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$key = (Resolve-Path -LiteralPath $KeyPath).Path
if ($Server -notmatch '^[a-zA-Z0-9.-]+$' -or $User -notmatch '^[a-zA-Z0-9_-]+$') { throw "无效的 SSH 地址" }
if ($InstallRoot -notmatch '^/opt/[a-zA-Z0-9_-]+$' -or $NodeBin -notmatch '^/[a-zA-Z0-9_./-]+$') { throw "无效的远程路径" }
if ($SshPort -lt 1 -or $SshPort -gt 65535 -or $ControlPort -lt 1024 -or $ControlPort -gt 65535) { throw "端口超出范围" }
foreach ($file in @("dist\index.html", "server-dist\standalone.mjs")) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $file))) { throw "缺少产物 $file，请先执行 npm run build:friends。" }
}
$id = [Guid]::NewGuid().ToString("N")
$archive = Join-Path ([IO.Path]::GetTempPath()) "tyrants-$id.tar.gz"
$remote = "/tmp/tyrants-$id"
$target = "${User}@${Server}"
$sshArgs = @("-i", $key, "-p", "$SshPort", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15")
$scpArgs = @("-i", $key, "-P", "$SshPort", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15")
try {
    # 明确列出文件，不会上传私钥、node_modules、历史日志和未构建源码。
    & tar.exe -czf $archive -C $root dist server-dist deploy/install-server.sh deploy/tyrants.service deploy/logrotate.tyrants
    if ($LASTEXITCODE -ne 0) { throw "打包失败" }
    $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    & scp.exe @scpArgs $archive "${target}:${remote}.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw "上传失败" }
    # 安装和重启前校验整包哈希，防止不完整产物进入 release。
    $command = "set -eu; echo '$archiveHash  $remote.tar.gz' | sha256sum -c -; mkdir '$remote'; tar -xzf '$remote.tar.gz' -C '$remote' deploy; bash '$remote/deploy/install-server.sh' '$remote.tar.gz' '$ControlPort' '$InstallRoot' '$NodeBin'; rm -f '$remote.tar.gz'"
    & ssh.exe @sshArgs $target $command
    if ($LASTEXITCODE -ne 0) { throw "远程安装或健康检查失败" }
    Write-Host "部署成功：http://${Server}:$ControlPort"
} finally {
    # 只删除本脚本生成的单个临时文件，不做递归删除。
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
