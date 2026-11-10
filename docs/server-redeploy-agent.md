# 本项目重新打包与服务器部署规则

## 新对话的调用方式

把本文件附到新对话，或让 Agent 读取本文件，并发送：

> 请按 `docs/server-redeploy-agent.md`，把当前工作副本的最新逻辑重新打包并部署到我的服务器。允许本次构建、上传和重启服务；我知道部署会结束当前所有对局。请完成公网验收后交付。

这句话是当次构建与部署授权。只有修改代码、讨论方案或读取本文件时，不得自动构建或部署。

## 项目和服务器参数

- 项目：幽暗地域暴君（tyrants-of-the-underdark），React/TypeScript + boardgame.io 网页回合制游戏。
- 项目根目录从本文件所在的 `docs/` 的上一级推导；如果用户指定另一个工作副本，使用用户指定的工作副本，不混用分支产物。
- 公网入口：`http://server.example.com:8080`。
- SSH：`deploy-user@server.example.com`，端口 `22`。
- 示例私钥路径：`~/.ssh/id_ed25519`。仅交给 SSH/SCP 使用，不读取、输出、复制或上传私钥内容。
- 远程目录：`/opt/tyrants`；当前版本链接：`/opt/tyrants/current`。
- systemd 服务：`tyrants.service`；运行用户：`tyrants`；Node：`/usr/bin/node`。
- 配置：`/etc/tyrants.env`；日志：`/var/log/tyrants/server.log`。
- TCP `8080` 同时提供网页与 API；本项目不使用 UDP `20000–20099`。
- 其他服务不在本次部署范围，不得擅自停止、覆盖或删除。

## 必须保持的产品约束

- 2–4 位真人、6 位房号、至少 2 人由房主开始，服务端校验房主权限。
- 使用单台公网权威服务器；不引入 P2P、UPnP、玩家主机。
- 不启用在线 AI、AI 补位、账号、排行榜、Supabase 或持久化存档。
- `/solo` 提供浏览器本地 AI：1～3 个对手、四档难度，不创建服务器房间。发布后检查直接访问及刷新此路径。
- 本地 AI 与真人联机都只允许完整预下载图片或无图模式，不允许局内按需下载；需验收缺图回退和图片设置。
- 对局仅存服务器内存；重新部署或重启会丢失当前全部对局。不要承诺热更新保留对局。
- 明文 HTTP、裸 IP；除非用户另行要求，不增加域名或 HTTPS 配置。
- `MAX_ROOMS=100` 是保护上限，不代表支持 100 并发；没有压测不得承诺容量。
- 当前空房回收 300 秒、失联宽限 120 秒、可用内存保留值 300 MiB。修改这些行为需依据用户需求。
- 新增/修改代码注释用中文；新增玩家文案进入 StringTable。

## 执行流程

项目现有 `deploy-server.cmd` → `deploy/redeploy.ps1` 可串联自动化流程，
参数来自本机的 `deploy/settings.psd1`，首次从 `deploy/settings.example.psd1`
复制并填写；好友服环境开关从 `.env.friends.example` 复制为 `.env.friends`。
真实地址和私钥路径不得写入公开文档或提交到 Git。当次明确授权后可执行
`powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\redeploy.ps1 -ConfirmRestart`。
它包括下面的测试、构建、本机验收、上传重启及公网 HTTP 验收；
不要在脚本成功后再部署一次。浏览器图形验收仍按第 10 步另做。

1. 先读取当前工作副本适用的 `AGENTS.md`、本规则、`docs/friends-server.md`、
   `package.json` 和 `deploy/` 中的脚本。涉及代码定位时先检查当前副本 CodeGraph 索引；
   无可用索引时定向读取相关源码。保留用户当前逻辑改动，不重置或覆盖工作副本。
2. 确认当次用户已明确允许构建与部署。已按上述调用方式授权时，直接执行，不重复索要许可。
   说明本次发布会结束内存对局；此授权不涵盖更改其他项目、删除旧版本或升级系统。
3. 检查依赖是否可用；仅在缺失或锁文件变更导致需要时执行
   `npm.cmd ci --ignore-scripts --no-audit --no-fund`。不擅自升级依赖。
4. 执行 `npm.cmd run test:rooms`，并针对本次修改运行相关现有测试；
   若启用 `VITE_TOTU_SERVER_IMAGES`，先运行 `npm.cmd run preload:images`
   准备完整卡图和地图，再运行 `npm.cmd run prepare:server-images`
   生成同尺寸 WebP 与内容哈希清单，然后运行 `npm.cmd run test:server-images`；
   然后执行 `npm.cmd run build:friends`。逐步检查退出码，任一步失败先定位修复，
   不上传失败产物或复用旧产物冒充本次构建。
5. 必须同时得到同一工作副本本次构建的 `dist/` 和
   `server-dist/standalone.mjs`。使用 `build:friends`，不要使用会发布到
   Cloudflare 的 `npm run ship`，不要使用 Vite 开发服务器承载公网服务。
6. 使用独立端口（例如 `127.0.0.1:18080`）启动本次独立服务，
   设置 `SMOKE_BASE` 后运行 `npm.cmd run test:rooms-http`。
   只停止自己启动的测试进程，禁止按进程名批量终止 Node/Godot。
7. SSH 只读检查当前服务、健康接口及 `current` 指向，记录上一 release 的准确路径。
   使用原有私钥和主机指纹校验；密钥缺失或连接失败应报告具体阻碍，不输出凭证、
   不关闭主机校验来绕过错误。
8. 在项目根目录执行已有部署脚本：

   ```powershell
   & .\deploy\deploy.ps1 `
     -Server server.example.com `
     -KeyPath '~/.ssh/id_ed25519'
   ```

   该脚本只上传构建产物及部署文件，创建新 release、切换 `current` 并重启服务。
   不上传 `node_modules`、私钥、历史日志或无关源码；不擅自删除历史 release。
9. 部署后把 `SMOKE_BASE` 设置为 `http://server.example.com:8080`，
   运行同一 `test:rooms-http` 公网双席位测试，结束后清理测试席位。
   检查网页、`/api/health`、`tyrants.service`、日志及实际 release 路径；
   必要时比较本地和服务器产物哈希，确认运行的是本次版本。
10. 如果改了房间/联机/界面流程，使用两个独立浏览器席位验证房号加入、
    房主开局、双方更新与刷新重连；测试本次修改的实际功能。
    改了回收逻辑时另验空房回收。不得把 API 测试表述成图形验收，
    不得结束真实玩家的对局来清理测试数据。
11. 发布失败先检查安装脚本是否已恢复上一 release，并验证恢复后的服务。
    必要时切回先前记录且确实存在的上一 release、启动 `tyrants.service` 并验健康。
    不回滚成其他项目，不为恢复服务删除用户文件。
12. 关闭自己启动的本地测试进程。交付公网入口、发布版本、改动摘要、
    实际通过的检查与未完成项；不要仅报告“上传成功”。
    文档中的时间使用 Asia/Shanghai。

## 验收边界

依赖当前代码及现有脚本的实际行为；若与本文不一致，先查明差异，不盲目套用命令。
服务器重启后 `rooms: 0` 仅证明内存已清空，不能冒充 300 秒自然回收测试。
公网双标签页不等于两台异地设备验收；少量动作不等于完整终盘回归或容量压测。
