# 只读查看线上服务；复用连接配置，不构建、不上传、不重启。
[CmdletBinding()]
param(
    [string]$SettingsPath,
    [switch]$Once,
    [switch]$Logs,
    [ValidateRange(3, 3600)][int]$IntervalSeconds = 5,
    [ValidateRange(1, 500)][int]$Lines = 15
)
$ErrorActionPreference = 'Stop'
# 从其他 PowerShell 版本启动时，继承的模块搜索路径可能缺少 Windows 自带模块。
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
if (-not $SettingsPath) { $SettingsPath = Join-Path $PSScriptRoot 'settings.psd1' }
if ($Once -and $Logs) { throw '-Once 和 -Logs 不能同时使用。' }
$settings = Import-PowerShellDataFile -LiteralPath $SettingsPath
foreach ($name in @('Server', 'KeyPath', 'User', 'SshPort', 'ControlPort', 'InstallRoot')) {
    if (-not $settings.ContainsKey($name)) { throw "配置缺少 $name：$SettingsPath" }
}
if ($settings.Server -notmatch '^[a-zA-Z0-9.-]+$' -or $settings.User -notmatch '^[a-zA-Z0-9_-]+$') { throw '无效的 SSH 地址。' }
if ($settings.InstallRoot -notmatch '^/opt/[a-zA-Z0-9_-]+$') { throw '无效的远程目录。' }
foreach ($name in @('SshPort', 'ControlPort')) {
    if ([string]$settings[$name] -notmatch '^\d+$' -or [int]$settings[$name] -lt 1 -or [int]$settings[$name] -gt 65535) {
        throw "配置端口无效：$name"
    }
}
$key = (Resolve-Path -LiteralPath $settings.KeyPath).Path
Get-Command ssh.exe -ErrorAction Stop | Out-Null
$sshArgs = @('-i', $key, '-p', [string]$settings.SshPort, '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2')
$target = "$($settings.User)@$($settings.Server)"
if ($Logs) {
    Write-Host '持续查看日志，按 Ctrl+C 退出。created=建房，started=真人开局，reclaimed=回收，[LOCAL_AI] started=本地 AI 开局。' -ForegroundColor Cyan
    & ssh.exe @sshArgs $target "tail -n $Lines -F /var/log/tyrants/server.log"
    if ($LASTEXITCODE -ne 0) { throw "日志连接结束，SSH 退出码：$LASTEXITCODE" }
    return
}
# 第一行仅传输健康 JSON，后续行保留系统诊断输出；不读取席位凭证或进程环境。
$snapshotCommand = @'
curl -fsS --max-time 5 'http://127.0.0.1:__PORT__/api/health' || printf '{"ok":false}'
printf '\n'
systemctl show tyrants.service -p ActiveState -p SubState -p NRestarts -p MemoryCurrent -p MemoryPeak
printf '\n[release]\n'
readlink -f '__ROOT__/current'
printf '\n[server memory MiB]\n'
free -m
printf '\n[CPU load: 1/5/15 minutes]\n'
uptime
printf '\n[recent game logs]\n'
tail -n __LINES__ /var/log/tyrants/server.log
'@
$snapshotCommand = $snapshotCommand.Replace('__PORT__', [string]$settings.ControlPort).
    Replace('__ROOT__', [string]$settings.InstallRoot).Replace('__LINES__', [string]$Lines).Replace("`r", '')
Write-Host "目标：http://$($settings.Server):$($settings.ControlPort)" -ForegroundColor Cyan
Write-Host '房间总数包括大厅、对局和等待回收的空房；当前接口不提供在线人数/对局房数。'
Write-Host '本地 AI 显示累计开局次数，不是在线房间或独立玩家数；离线补报按服务器收件日期统计（北京时间）。'
if (-not $Once) { Write-Host "每 $IntervalSeconds 秒刷新，按 Ctrl+C 退出。" }
do {
    Write-Host "`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') =====" -ForegroundColor Cyan
    $output = @(& ssh.exe @sshArgs $target $snapshotCommand)
    if ($LASTEXITCODE -ne 0) { throw "SSH 状态查询失败，退出码：$LASTEXITCODE" }
    if ($output.Count -eq 0) { throw '服务器没有返回状态。' }
    try { $health = $output[0] | ConvertFrom-Json }
    catch { throw '健康接口未返回有效 JSON，请通过 -Logs 查看日志。' }
    if ($health.ok) {
        Write-Host "现存房间：$($health.rooms) / 保护上限 $($health.max_rooms)" -ForegroundColor Green
        Write-Host "服务器可用内存：$($health.available_mb) MiB；保留阈值：$($health.reserve_mb) MiB"
        Write-Host "失联宽限：$($health.disconnect_seconds) 秒；空房回收：$($health.room_idle_seconds) 秒"
        if ($health.local_ai -and $health.local_ai.available) {
            Write-Host "本地 AI 累计开局：$($health.local_ai.total)；今日：$($health.local_ai.today)；近 7 天：$($health.local_ai.last_7_days)" -ForegroundColor Green
            if ($health.local_ai.last_start) {
                $chinaZone = [TimeZoneInfo]::FindSystemTimeZoneById('China Standard Time')
                $lastStart = [DateTimeOffset]::Parse($health.local_ai.last_start)
                $localStart = [TimeZoneInfo]::ConvertTime($lastStart, $chinaZone).ToString('yyyy-MM-dd HH:mm:ss zzz')
                Write-Host "本地 AI 最近开局收件：$localStart"
            } else { Write-Host '本地 AI 最近开局收件：暂无记录' }
        } elseif ($health.local_ai) {
            Write-Warning '本地 AI 统计暂不可用，请检查统计文件的权限或内容；不会显示为零。'
        } else {
            Write-Host '本地 AI 统计：当前服务器版本尚未接入。' -ForegroundColor Yellow
        }
    } else {
        Write-Warning '游戏健康检查失败，请检查下方服务状态和日志。'
    }
    $output | Select-Object -Skip 1 | ForEach-Object { Write-Host $_ }
    if (-not $Once) { Start-Sleep -Seconds $IntervalSeconds }
} while (-not $Once)
