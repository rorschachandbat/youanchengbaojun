# 从当前脚本定位工作副本，串联本机测试、构建、上传重启与公网验收。
param(
    [string]$SettingsPath = (Join-Path $PSScriptRoot 'settings.psd1'),
    [switch]$ConfirmRestart
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$originalLocation = Get-Location
$names = @('BIND_HOST', 'CONTROL_PORT', 'SMOKE_BASE')
$savedEnv = @{}
foreach ($name in $names) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$process = $null
$exitCode = 1
function Run-Npm([string]$Task) {
    Write-Host "`n>>> npm run $Task" -ForegroundColor Cyan
    & npm.cmd run $Task
    if ($LASTEXITCODE -ne 0) { throw "步骤失败：npm run $Task（$LASTEXITCODE），已停止后续部署。" }
}
try {
    Set-Location -LiteralPath $root
    $settings = Import-PowerShellDataFile -LiteralPath $SettingsPath
    foreach ($name in @('Server', 'KeyPath', 'User', 'SshPort', 'ControlPort', 'InstallRoot', 'NodeBin', 'SmokePort')) {
        if (-not $settings.ContainsKey($name)) { throw "配置缺少 $name：$SettingsPath" }
    }
    if ($settings.Server -notmatch '^[a-zA-Z0-9.-]+$' -or $settings.User -notmatch '^[a-zA-Z0-9_-]+$') { throw '无效的 SSH 地址' }
    if ($settings.InstallRoot -notmatch '^/opt/[a-zA-Z0-9_-]+$' -or $settings.NodeBin -notmatch '^/[a-zA-Z0-9_./-]+$') { throw '无效的服务器路径' }
    foreach ($name in @('SshPort', 'ControlPort', 'SmokePort')) {
        $minimum = if ($name -eq 'SshPort') { 1 } else { 1024 }
        if ($settings[$name] -lt $minimum -or $settings[$name] -gt 65535) { throw "配置端口无效：$name" }
    }
    $key = (Resolve-Path -LiteralPath $settings.KeyPath).Path
    foreach ($tool in @('node.exe', 'npm.cmd', 'ssh.exe', 'scp.exe', 'tar.exe')) { Get-Command $tool -ErrorAction Stop | Out-Null }
    $nodeVersion = [version](& node.exe -p 'process.versions.node')
    if ($nodeVersion -lt [version]'22.12.0') { throw '本机构建需要 Node.js 22.12 或更新版本。' }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules/.bin/vite.cmd'))) {
        & npm.cmd ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
    }
    Write-Host "当前工作副本：$root"
    Write-Host "发布目标：http://$($settings.Server):$($settings.ControlPort)"
    Run-Npm 'preload:images'
    Run-Npm 'prepare:server-images'
    foreach ($task in @('test:rooms', 'test:server-images', 'test:local-ai', 'test:local-ai-stats', 'test:difficulty', 'test:image-cache', 'test:zh', 'build:friends')) { Run-Npm $task }
    # 临时监听检查失败时不尝试终止占用端口的其他进程。
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, [int]$settings.SmokePort)
    try { $probe.Start() } finally { $probe.Stop() }
    $env:BIND_HOST = '127.0.0.1'
    $env:CONTROL_PORT = [string]$settings.SmokePort
    $env:SMOKE_BASE = "http://127.0.0.1:$($settings.SmokePort)"
    $logPrefix = Join-Path ([IO.Path]::GetTempPath()) ("tyrants-smoke-" + [Guid]::NewGuid().ToString('N'))
    $process = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'server-dist/standalone.mjs' -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logPrefix.out.log" -RedirectStandardError "$logPrefix.err.log"
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($process.HasExited) { throw "本机测试服务启动失败，日志：$logPrefix.err.log" }
        try { $null = Invoke-RestMethod "$env:SMOKE_BASE/api/health" -TimeoutSec 2; $ready = $true; break }
        catch { Start-Sleep -Milliseconds 300 }
    }
    if (-not $ready) { throw "本机测试服务未就绪，日志：$logPrefix.err.log" }
    Run-Npm 'test:rooms-http'
    Run-Npm 'test:release-http'
    $process.Refresh()
    if (-not $process.HasExited) { Stop-Process -Id $process.Id }
    $process = $null
    $sshArgs = @('-i', $key, '-p', [string]$settings.SshPort, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15')
    $target = "$($settings.User)@$($settings.Server)"
    $remoteRoot = $settings.InstallRoot
    $preflight = "set -eu; readlink -f '$remoteRoot/current'; systemctl is-active tyrants.service; curl -fsS 'http://127.0.0.1:$($settings.ControlPort)/api/health'"
    & ssh.exe @sshArgs $target $preflight
    if ($LASTEXITCODE -ne 0) { throw '服务器预检查失败；未上传或重启。' }
    if (-not $ConfirmRestart) {
        $answer = Read-Host '本机验收通过。发布会重启服务并结束全部当前对局。输入 YES 上传并发布，其他输入取消'
        if ($answer -cne 'YES') { Write-Host '已取消发布；本机构建产物保留。'; $exitCode = 0; return }
    }
    & (Join-Path $PSScriptRoot 'deploy.ps1') -Server $settings.Server -KeyPath $key -User $settings.User -SshPort $settings.SshPort -ControlPort $settings.ControlPort -InstallRoot $settings.InstallRoot -NodeBin $settings.NodeBin
    $env:SMOKE_BASE = "http://$($settings.Server):$($settings.ControlPort)"
    Run-Npm 'test:rooms-http'
    Run-Npm 'test:release-http'
    & ssh.exe @sshArgs $target "set -eu; readlink -f '$remoteRoot/current'; systemctl show tyrants.service -p ActiveState -p NRestarts -p ActiveEnterTimestamp; curl -fsS 'http://127.0.0.1:$($settings.ControlPort)/api/health'"
    if ($LASTEXITCODE -ne 0) { throw '发布后服务状态检查失败' }
    Write-Host "`n构建、上传重启与公网 HTTP 验收均通过：$env:SMOKE_BASE" -ForegroundColor Green
    Write-Host '浏览器验收：确认图片设置、预下载、双人加入/开局和刷新重连。'
    $exitCode = 0
} catch {
    Write-Host "`n部署流程失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host '已停止后续操作；如已进入上传阶段，请检查上方安装或公网验收结果。历史 release 不会被删除。'
} finally {
    if ($null -ne $process) {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id }
    }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name], 'Process') }
    Set-Location -LiteralPath $originalLocation
}
exit $exitCode
