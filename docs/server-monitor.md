# 远程监看游戏服务器

在项目根目录双击 `monitor-server.cmd`，或在 PowerShell 执行：

```powershell
.\monitor-server.cmd
```

每 5 秒显示现存房间总数、保护上限、可用内存、服务状态、重启次数、
当前 release 和最近 15 行日志。按 Ctrl+C 退出。
该工具通过 SSH 只读查询，不构建、不上传、不重启，也不影响正在玩的对局。

只看一次：

```powershell
.\monitor-server.cmd -Once
```

连续跟随日志（含日志轮转），默认先显示最近 15 行：

```powershell
.\monitor-server.cmd -Logs -Lines 50
```

修改刷新间隔：

```powershell
.\monitor-server.cmd -IntervalSeconds 10
```

连接参数复用 `deploy/settings.psd1`。需要 Windows OpenSSH 客户端、可用私钥以及
已确认的服务器主机指纹。不会输出私钥内容或席位凭证。
也可在任意目录通过绝对路径调用启动器；复制到其他工作副本时，
一起复制根目录启动器、`deploy/monitor-server.ps1` 和 `deploy/settings.psd1`，
保持目录结构。主机及私钥路径属于连接配置，换机器时按实际环境修改。

## 如何理解输出

- `现存房间`：健康接口的当前房间总数，包括等待开始、正在对局以及
  等待 300 秒回收的空房。当前服务不能准确区分这些分类，也不提供在线玩家数量。
- `[ROOM] created 123456`：创建了该房号。
- `[ROOM] started 123456 2`：该房号以 2 位玩家开局，这是历史事件，
  不能据此判断此刻是否仍在玩。没有逐次加入/离开日志，不要靠计数推算在线人数。
- `[ROOM] reclaimed 123456`：房间已回收。
- `ActiveState=active`、`SubState=running`：服务进程正常运行；
  健康接口正常才说明应用能响应。
- `MemoryCurrent` / `MemoryPeak`：systemd 统计的服务内存字节数；
  `free -m` 显示整台服务器内存，重点看 `available`。
- `NRestarts`：systemd 自动重启计数；出现增长时结合日志排查。

HTTP 使用短请求和轮询，TCP 连接数不等于在线人数，因此监看命令不把连接数当玩家数。
若要精确显示“正在对局几房、等待几房、每房在线几人”，需另行实现受保护的运维统计接口，
经当次构建与重启发布后才能生效；本工具不新增公网管理入口。
