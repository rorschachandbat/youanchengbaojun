# 单公网服务器好友联机

## 本项目与 Godot Playbook 的对应关系

本项目是 React/TypeScript 回合制桌游，使用 HTTP 轮询和服务器权威规则校验，
不是 Godot/ENet 游戏。沿用房号、房主手动开始、资源保护、systemd 和验收思路，
不引入 P2P、UPnP、玩家主机、30Hz 输入、插值或无意义的 UDP 监听。

- 当前地址：`http://server.example.com:8080`
- TCP 控制面和网页共用 8080；UDP 20000–20099 保留但不使用，不必开放。
- SSH：按本地配置指定用户和端口；私钥由 `deploy.ps1 -KeyPath` 传入，禁止提交。
- 部署目录：`/opt/tyrants`；独立非 root 用户：`tyrants`。
- 已有服务器上的其他服务不属于本项目部署范围，不得擅自停止或修改。

## 玩家流程

打开同一个 HTTP 地址，输入昵称，选择创建或加入房间后先确认图片设置。
必须完整下载到当前浏览器，或使用无图模式；准备图片时尚未占用房间席位。
创建房间后把 6 位房号告诉朋友。
朋友输入昵称和房号加入。2–4 人，由当前 slot 最小的房主点击开始，不会自动开局。
房间人数上限可设 2/3/4，达到至少 2 人即可开始；开局人数决定地图范围。
运行中的游戏不接收新玩家。玩家只得到自己的席位凭证，服务器隐藏别人的手牌。

仅真人联机：没有在线 AI、AI 补位、账号、排行榜、Supabase 或存档恢复。
完整游戏状态和最多 100 条聊天保存在进程内存，只有最新快照，不落盘；
服务重启、换版部署、进程崩溃都会丢失全部对局。
浏览器 `sessionStorage` 只记当前标签页连接凭证，刷新时用于重连，不是游戏存档。

首页另有「与 AI 对战」，进入 `/solo` 后在浏览器本机运行：可选择 1～3 个 AI，
每个对手独立选择随机、简单、标准或困难，保留牌组和玩家颜色等本地设置。
此入口不创建或轮询服务器房间，不上传对局日志；存档与归档仅保存在玩家浏览器。
明确开始新局时仅向本站发送一个匿名开局事件，用于累计次数，刷新或继续存档不新增事件。
服务器提供网页、准备阶段的图片和轻量计数，不持有本地 AI 棋局，也不计算 AI 落子。
进入及刷新本地 AI 页面时先确认图片准备，取消返回好友大厅。
本地多 AI 的计算资源由玩家设备承担；困难 AI 的思考速度取决于设备性能。

大厅主动离开立即转移房主；失联 120 秒后移除成员。
开局后主动离开或超过失联宽限时间，结束本局，其他玩家返回同一个房间重新开始，
不会启动 AI 代打，也不会留下无人能操作的棋局。
无成员后等待 300 秒回收房间。关页不会保证立即离开，按失联时限回收。

## 本地 AI 开局统计与监控

双击根目录 `monitor-server.cmd` 查看，或运行 `.\monitor-server.cmd -Once` 只查一次。
原有真人房间数继续显示，新增本地 AI 累计开局、今日、近 7 天和最近开局收件时间。
`.\monitor-server.cmd -Logs` 可查看 `[LOCAL_AI] started` 事件日志；长期累计以统计文件为准，
不依赖会轮转的日志。旧服务器会提示尚未接入，统计文件不可用时会提示异常，不伪装成零。
复制监控工具到另一工作副本时，保留根目录启动器、`deploy/monitor-server.ps1`
和本机 `deploy/settings.psd1` 的相对布局；连接目标来自配置，与分支及启动目录无关。

每次明确新开局只发送一个随机事件 ID，多个 AI 的同一局仍记一次。
不上传昵称、棋局、难度、手牌、存档或跨对局的玩家标识；统计快照不保存 IP。
接口沿用同源 JSON 校验，每 IP 每分钟最多 30 次统计请求及 600 次总 API 请求。
这是一项客户端自报的开局次数统计，不代表独立玩家、完成局数或当前活跃人数，也不防伪造。
历史无法回填，需前后端一起重新构建部署后才开始采集。

发送失败不阻止游戏；浏览器最多缓存最近 20 条待发事件，下次进入本地 AI 页面或新开局时补报，
不持续轮询。清除网站数据、存储不可用、多标签页同时写入或长期断网可能漏报。
今日和近 7 天按服务器收到事件的北京时间自然日统计，离线补报不追溯实际开局日。
服务端只保留最近 2048 个事件 ID 去重、31 个日期分桶和长期累计数；极晚重放的旧事件可能重复计数。

systemd 将 `LOCAL_AI_STATS_FILE` 设为 `/var/log/tyrants/local-ai-stats.json`；
直接运行源码或产物时，默认写项目 `logs/local-ai-stats.json`，可用同名环境变量覆盖。
统计文件由服务用户写入，位于 release 外，升级或重启不清零，logrotate 不处理该文件。
备份时保存此文件即可；不要上传 Git、删除或用空文件覆盖。损坏或无权限时接口拒绝确认收件，
监控提示不可用，应先保留原文件排查。此存储仅适用于当前单进程服务，多进程部署需另行调整。

## 资源与安全边界

`/etc/tyrants.env`：

```ini
BIND_HOST=0.0.0.0
CONTROL_PORT=8080
MAX_ROOMS=100
RESERVE_MB=300
ROOM_IDLE_SECONDS=300
DISCONNECT_SECONDS=120
```

100 是防失控上限，**不是 100 并发/满员房的承诺**。服务器可能还运行其他服务。
Godot 一房一进程的内存估算不适用于这里；容量需要按本项目实测峰值和其他服务占用确定。
低于可用内存保留值或 Node 堆水位过高时拒绝创建，已有对局不主动丢弃。
systemd 将本服务限制为 768 MiB，Node 堆 384 MiB；超限重启会丢局，
所以资源保护不等于“不会 OOM”，不得据上限承诺容量。

6 位房号仅防误入，不是强身份验证。每个席位另有随机连接凭证。
明文 HTTP 不防窃听或中间人攻击；不要使用敏感昵称或传输密码/支付信息。
API 不记录 token，不暴露公共对局列表、其他席位凭证、报告管理或 AI 接管接口。
同 IP 每分钟最多创建 5 房、加入 60 次、总 API 请求 600 次；不信任伪造的代理 IP。
请求体最多 16 KiB，只接受 JSON object，拒绝跨站 Origin。多人共用一个出口会共享限流。
SSH 应仅向自己的来源 IP 开放；云安全组、系统防火墙、监听分别验证。
安装脚本不会自动启用防火墙或修改云安全组，须按目标环境人工检查。

## 构建与部署

### 双击一键更新

双击项目根目录的 `deploy-server.cmd`，按当前副本执行：
检查依赖 → 准备图片 → 测试 → 构建前后端 → 独立端口本机 HTTP 验收 →
服务器只读预检查 → 输入 `YES` 确认 → 上传并校验整包 SHA256 →
切换 release 并重启 → 公网双席位 HTTP 及图片验收。
任一步失败即停止，不会拿旧产物继续上传；部署期间会结束全部内存对局。
公网自动验收会创建自己的测试房并退出席位，不清理其他玩家的房间。
部署安装脚本会在启动健康检查失败时尝试恢复上一个 release；
后续公网测试失败则报告失败供排查，不自动重启第二次。

首次使用把 `deploy/settings.example.psd1` 复制为 `deploy/settings.psd1`，
再填写连接参数、私钥路径和本机验收端口；把 `.env.friends.example` 复制为 `.env.friends`。
真实配置与私钥仅保留在本机，已加入 Git 忽略规则；SSH 使用既有主机指纹校验，
首次连接或更换服务器需先人工核对 SSH 主机指纹，不能关闭校验绕过。
本机需 Node.js 22.12+（或 24+）、Windows PowerShell、OpenSSH 的 ssh/scp 和 tar。
依赖缺失时用当前 `package-lock.json` 安装；依赖有变更时先执行 `npm ci --ignore-scripts`。
本机验收日志保存在系统临时目录 `tyrants-smoke-*.out.log/err.log`。
图形验收仍需在浏览器检查图片设置、加入/开局和刷新重连。

从其他目录调用或复制到另一工作副本时，保留 `deploy-server.cmd`、
整个 `deploy/`、`scripts/`、项目源码和锁文件的相对布局。
脚本从自身位置找项目根目录，每次重新构建该副本，不绑定分支名或预先生成的产物。
切换环境后修改配置里的服务器/密钥/端口即可；不会终止其他进程来抢占测试端口。
需要命令行调用时：

```powershell
& .\deploy\redeploy.ps1
# 已明确授权的自动化调用可加 -ConfirmRestart 跳过最后的 YES 提示。
```

### 手动步骤与图片上传

好友服通过 `.env.friends` 的 `VITE_TOTU_SERVER_IMAGES=true` 读取本站
`/media/<内容SHA256>.webp`，不会访问第三方图床。玩家可选：

- **本地图片（推荐）**：进入房间前下载到当前浏览器的 IndexedDB。
  显示进度，可停止后继续；完整下载并校验当前清单后才能继续，已保存文件不会重复下载。
- **无图模式**：立即进入，使用文字卡牌和可操作的示意地图，不请求卡图或地图图片。

本地 AI 和真人联机都遵守以上规则，不提供边玩边加载或缺图在线补齐。
旧版的服务器直读偏好会回到预下载选择。对局中缓存丢失时使用文字卡牌或示意地图，
可通过图片设置重新完成整包下载后启用图片；哈希文件名的 HTTP 缓存仍用于准备阶段复用。

完整图片包约 12.6 MB（206 个去重文件），原 JPEG 合计约 38.3 MB；
WebP 保持原像素尺寸，但使用有损压缩。预下载只把首次等待移到对局前，
不能提高公网带宽。本地图片不是文件夹导入或离线联机；清理网站数据、
隐私模式、存储空间不足可能影响缓存，可随时通过「图片设置」切换。
开启图像时，中文卡名和完整效果显示在原版卡图下方；关闭图像时仍可使用文字卡面。

首次发布或卡图更新前，在当前工作副本执行 `npm run preload:images`，
准备 211 张卡图和 1 张地图，再执行 `npm run prepare:server-images` 生成
`assets/media/` 和 `src/server-image-manifest.json`。
`build:friends` 也会自动重新生成并检查优化图片，仅复制当前清单中的 WebP，
不打包原 JPEG、`assets/raw/` 原始牌组图或提取中间文件。

仅更新现有服务的静态图片时，可执行：

```powershell
& .\deploy\upload-images.ps1 -Server server.example.com `
  -KeyPath '~/.ssh/id_ed25519'
```

此脚本从自身目录推导工作副本，默认只上传当前清单对应的 `assets/media/`
和 SHA256 清单；验证 `current` 属于目标安装目录后写入当前 release 的 `dist/`。
它不构建、不切换版本、不重启，对局继续保留。新前端逻辑仍须重新构建部署。
仍运行旧 JPEG 前端的 release 需添加 `-OriginalJpeg`，上传 `cards/` 和 `board/`；
只上传 WebP 不会让旧前端自动切换。图片内容更新后也必须部署匹配的新清单与前端。
复制到其他分支时，保留 `deploy/upload-images.ps1` 与
`src/server-image-manifest.json`、`assets/media/` 的相对目录结构；
旧版 JPEG 上传另需 `assets/card-data.json`、`assets/cards/`、`assets/board/`。
生成脚本与项目一起复制，依赖仍通过当前副本的锁文件安装；
SSH 地址、私钥、端口和安装根可用参数指定。图片只上传到当前 release，
旧 release 未同步；回滚后如需卡图，应重新执行图片上传。

**仅在用户允许构建时执行：**

```powershell
npm ci --ignore-scripts
npm run test:rooms
npm run build:friends
powershell -File .\deploy\deploy.ps1 -Server server.example.com `
  -KeyPath ~/.ssh/id_ed25519
```

构建保留原有 `npm run build`；VPS 版本用 `build:friends` 同时生成 `dist/` 和
`server-dist/standalone.mjs`。部署脚本**不会自行构建**，服务器只需 Node >=20 和 systemd，
无需 npm 依赖、数据库、Godot 二进制。Node 安装不由脚本擅自升级。

脚本与本分支无绑定：从自身目录推导根目录，SSH key、IP、安装根、端口、Node 路径可传参；
复制到另一工作副本时需一起复制 `deploy/`、两个构建配置、`server/` 与房间 UI 源码，
并从目标分支重新构建。只部署该分支生成的 `dist/` + `server-dist/`，
不能混用不同分支的前后端产物。PowerShell 文件使用 UTF-8 BOM。

每次部署创建新 release，再切换 `current` 符号链接，旧 release 保留。
安装脚本健康检查失败会尝试切回上一个 Tyrants release；首次安装失败无旧 release 可恢复。
服务使用 `KillMode=control-group`，日志 `/var/log/tyrants/server.log`，logrotate 保留 7 份。

```bash
systemctl status tyrants --no-pager
tail -n 50 /var/log/tyrants/server.log
curl -f http://127.0.0.1:8080/api/health
systemctl restart tyrants   # 注意：会丢失全部内存对局
```

回滚前应确认目标服务器上的服务配置；以下操作仅作示例：

```bash
systemctl disable --now tyrants
# 按目标环境恢复所需的原有服务
```

## 验收（按 Playbook 第 7/9 节适配）

1. `npm run test:rooms`：房主校验、最低人数、房主转移、凭证隔离、
   断线/空房清理、内存/房数上限、旧快照冲突、禁止 AI/弃席接管。
   `npm run test:local-ai-stats`：独立临时目录及回环源码服务，验证去重、日期、补报、
   重启保留、损坏文件保护和不占服务器房间；不会向线上统计写测试记录。
2. `npm run build:friends`：前端及后端类型检查、产物生成。
3. 启动 `npm run start:server`；设 `SMOKE_BASE=http://127.0.0.1:8080`，
   执行 `npm run test:rooms-http`。失败先修复，再部署。
4. 部署后设 `SMOKE_BASE=http://server.example.com:8080`，执行同一测试：
   两个独立玩家席位经过公网 HTTP 创建/加入/开始/落子/聊天，验证私有手牌。
   这证明公网 HTTP 链路，不宣称验证本项目不使用的 UDP。
5. 两个独立浏览器会话实际创建和输入房号，确认人数不足不能开始、非房主无开始按钮、
   双方棋盘更新、昵称/中文文案正常；不以纯 API 测试冒充图形验收。
6. 测试后空房等待 300 秒，`/api/health` 房数归零；无房间子进程或 UDP 端口需回收。
7. `logrotate -f /etc/logrotate.d/tyrants` 后，服务继续可用。
8. 检查本项目服务 active / enabled，其他服务保持原状，重启无旧对局。

## 本地部署记录

实际地址、密钥路径、线上运行状态与验收截图仅保留在本机，不上传源码仓库。
