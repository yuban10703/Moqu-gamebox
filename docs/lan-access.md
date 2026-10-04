# 从别的设备打开 DSH Web GUI

面向本仓库的实际环境：**Windows + WSL2**，DSH Web GUI 跑在 WSL 里监听 `127.0.0.1:3080`。

## 零、先选方案：官方推荐哪个

官方文档（[dsh-web-app README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.zh.md)、[docs/subsystems/web-server.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-server.md)）
对「从别的设备访问」只给了两种被支持的拓扑，并明确拒绝第三种：

| 方案 | 官方态度 | 本环境可行性 | 代价 |
|---|---|---|---|
| **SSH 本地转发** | **推荐**（「最小远程边界」） | 需 Windows 有 sshd；也可从 WSL 反向转发 | 浏览器看到的仍是 loopback，**设置可持久化**，权限最完整 |
| 认证 HTTPS 网关 | 可选（面向多设备/纯浏览器） | 要自己维护 TLS + 身份认证 | 非回环页面，**设置只进内存**（见下） |
| 直接暴露端口 | **明确不支持** | 见方案 B，能用但属自担风险 | 同上；且 `--trusted-host` **不是认证** |

### 关键取舍：非回环页面会丢设置

这是本版本（0.2.0-rc.2）**源码里直接可验证**的限制，出自我在 `@deepseek-ai/dsh-client-ui-settings/lib/client.js` 与
`dsh-client-ui-settings-general/lib/client.js` 读到的判据：

```js
persistence = ctx.remote.$host.isLoopback ? "host" : "memory"          // 设置：非回环只进内存
const documentController = ctx.remote.$host.isLoopback ? new SettingsDocumentStore(...) : void 0   // 文档存储：非回环不创建
```

而 `isLoopback` 由**浏览器地址栏的主机名**决定（`pageLocation.hostname`），
与 DSH 怎么绑定监听、代理怎么转发**都无关**：

```js
isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)
```

**含义**：用 `http://10.1.1.69:3081/` 打开，页面主机名不是回环 → 设置改完刷新就没了，模型路由等配置项也无法持久化。
用 SSH 转发后用 `http://127.0.0.1:3080/` 打开，主机名是回环 → 一切正常。

> 想两者兼得：**方案 A 的 SSH 转发**，或方案 B 之后固定用 `localhost` 打开（若代理允许）。

## 一、为什么现在打不开

| 事实 | 含义 |
|---|---|
| `dsh web` 监听 `127.0.0.1:3080` | 只有 WSL 本机回环能连，局域网设备连不上 |
| `dsh` 的启动代码**拒绝** `--host 0.0.0.0` | 官方文档把它列为「已知限制」：直接暴露等于把远程代码执行交出去 |
| WSL2 是 NAT 网络（本机实测 `172.29.220.113/20`） | 这个地址**不在你的局域网里**，别的设备路由不到 |
| `/api` 有 Host 围栏 | 非回环来源必须在 `--trusted-host` 里登记，否则一律 403 |
| 页面需要启动 token | 直接打开 `http://<ip>:<port>/` 会 401，必须带 `?token=` |

官方文档还特别声明两件事，务必记住：

- **`--trusted-host` 是 DNS-rebinding / 同源信任声明，不是用户认证。** 它只决定「这个 Host 头是否被接受」，不代表调用者是谁。
- **官方拒绝直接暴露**：CLI 仍然拒 `--host 0.0.0.0`，Web 载体本身没有 TLS 也没有认证。任何绕过（改 Host 头、加防火墙、内网、UUID polyfill）都不构成认证。

所以本文件后面两条路：**方案 A（SSH 转发，官方推荐）** 与 **方案 B（端口转发直连，自担风险）**。


## 二、先解决 `dsh: command not found`

直接敲 `dsh` 会报找不到——**这不是漏装，而是这个 GUI 是从 npx 缓存里跑起来的**：

| 事实 | 证据 |
|---|---|
| `dsh` 并非已安装的命令 | 只有 `/root/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh` 这个缓存内的软链 |
| 缓存目录名带哈希 | `/root/.npm/_npx/<hash>/`，重装即变，**不能写死** |
| 整个树在 `/root` 下，权限 `0700` | 普通用户 `yuban` 连目录都进不去，`ls /root` 直接 Permission denied |
| Node 也装在 `/root` 下 | nvm 安装于 `/root/.nvm/versions/node/...`，`yuban` 同样不可读 |
| 凭据与会话在 `/root/.dsh` | `.credentials.yaml` 权限 `0600`，这个 GUI 的会话就存在这里 |

**结论：必须以 root 身份调用，且要显式给出 npx 缓存里的入口。** 那个 `sudo apt install dsh` 是 Debian 的**另一个同名包**，千万别装。

### 用法 A：装一个启动器（推荐，一次搞定）

```bash
# 在仓库根目录
sudo install -m 0755 tools/scripts/dsh-launcher.sh /usr/local/bin/dsh
```

之后就像普通命令一样用（它会在运行时自动定位缓存入口，哈希变了也不怕）：

```bash
sudo dsh --profile web --host 172.29.220.113 --trusted-host 10.1.1.69
```

### 用法 B：直接用完整路径，不装任何东西

```bash
sudo env "PATH=$PATH" node /root/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile web --host 172.29.220.113 --trusted-host 10.1.1.69
```

`env "PATH=$PATH"` 是把 `yuban` 的 PATH 带进 root 环境，因为 `node` / `npx` 都在 `/root/.nvm` 下、不在 root 的默认 PATH 里。

### 用法 C：装成真正的全局命令（长期最省事）

```bash
sudo "$(command -v npm)" i -g @deepseek-ai/dsh    # 装到 /root/.nvm/.../bin/dsh
sudo dsh --profile web --host 172.29.220.113 --trusted-host 10.1.1.69
```

装完 `dsh` 就落在 root 的 PATH 里了，不用再带完整路径。代价是版本从 npm 重新拉一份，可能与当前 GUI 的 `0.2.0-rc.2` 不同。

> 别用 `npx @deepseek-ai/dsh`：缓存已存在，npx 仍会去碰 npm 的 cache 目录重新解析，容易踩权限/只读问题。

## 三、方案 A：SSH 本地转发（官方推荐）

思路：**DSH 保持只绑回环不动**，由 SSH 把端口带到别的设备上，浏览器看到的一直是 `127.0.0.1`。

前提：Windows 侧要有 SSH 服务。Windows 自带 OpenSSH Server 可选功能，启用后在**管理员** PowerShell 里：

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
New-NetFirewallRule -DisplayName "OpenSSH Server (sshd)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22
```

然后在**别的设备**上建转发并打开：

```bash
ssh -N -L 3080:127.0.0.1:3080 yuban@10.1.1.69
# 另开终端或在浏览器里打开
# http://127.0.0.1:3080/?token=<dsh 启动时打印的 token>
```

优点（都是官方文档点明的）：远端监听和本地隧道端点**两端都保持回环**，浏览器主机名是真回环，
因此**设置可持久化**、权限判定与在本机操作一致，不需要 `--host`、不需要 `--trusted-host`、不需要改防火墙暴露端口。

手机/BOOX 上如果没有 ssh 客户端，这条路走不通——那就用方案 B，或装一个带 SSH 的终端 App。

## 四、方案 B：端口转发直连（能用，但有已知取舍）

> 走这条之前请确认你接受两件事：
> 1. **非回环页面设置只进内存**（见第零节），改完刷新可能丢失；
> 2. `--trusted-host` 不是认证，拿到带 token 的 URL 就等于拿到这台机器的命令执行。

## 五、WSL 侧：换监听地址（仅方案 B 需要）

在 WSL 里**另开一个终端窗口**执行。注意别在正在对话的这个终端里 Ctrl+C —— 那会直接终止当前会话（新旧两个进程可以同时存在：旧的占 `127.0.0.1:3080`，新的占 `<WSL-IP>:3080`，不冲突）。

```bash
# 1. 取 WSL 的 IP（脚本会自动读，这里只是让你知道它是什么）
hostname -I | awk '{print $1}'        # 实测为 172.29.220.113

# 2. 启动：监听 WSL 网卡，并登记 Windows 的局域网地址
sudo dsh --profile web --host 172.29.220.113 --trusted-host 10.1.1.69
```

（若没装用法 A 的启动器，就把上面的 `sudo dsh` 换成用法 B 的完整命令。）

两个参数的含义：

- `--host 172.29.220.113`：只多绑一张 WSL 网卡，不碰 `0.0.0.0`，因此不触发安全检查。
- `--trusted-host 10.1.1.69`：**换成你 Windows 的局域网 IPv4**（`ipconfig` 里连着你家 WiFi/路由器的那个适配器）。
  传**不带端口**的形式，按实现它匹配该主机名的**任意端口**，所以 Windows 侧用 3080 还是 3081 都不用改。

> `10.1.1.69` 是我从仓库 `.toolchain/ws-10_1_1_69_5555.txt` 里看到的地址，多半是你的 BOOX。
> **请以 `ipconfig` 实际输出为准**，填错了就是 403。


启动时会打印带 token 的地址，形如：

```
dsh web: http://127.0.0.1:3080/?token=xxxxxxxx
```

**把 `token=` 后面那串复制下来**，待会儿要用。它每次重启都会变（进程级），这是有意的。

> 注意打印的 host 永远是 `127.0.0.1`（即使你 `--host` 指了 WSL 网卡也一样，这是实现如此）。
> **别照抄这个 host**——要在别的设备上打开，把 host 换成 Windows 的局域网地址 + 脚本选定的外部端口：
> `http://10.1.1.69:3081/?token=<那串 token>`

## 六、Windows 侧：转发端口（管理员 PowerShell）

用仓库里的脚本，它会自动读 WSL IP、挑端口、建转发和防火墙规则：

```powershell
# 在【管理员】PowerShell 里运行
cd <仓库路径>\tools\scripts
.\windows-lan-forward.ps1 -LanIp 10.1.1.69

# 想只允许自己那个网段（更稳）：
.\windows-lan-forward.ps1 -LanIp 10.1.1.69 -RemoteAddress 10.1.1.0/24
```

脚本做的四件事：读 WSL IP → 选外部端口（3080 若被 Windows 的 WSL localhost 转发占用则用 3081）→
`netsh interface portproxy` 建立转发 → 加防火墙入站规则。输出结尾会直接给你可以打开的 URL。

### ⚠️ 转发目标不能写 `127.0.0.1:3080`

既然 Windows 上 `127.0.0.1:3080` 已经能打开 GUI，很容易顺手把转发目标写成 `127.0.0.1:3080`。**不要这么写**：

- Windows 的 `127.0.0.1:3080` 是 **wslrelay**（WSL 的 localhost 转发）在监听，它本身就是一层中转；
- `portproxy → 127.0.0.1:3080` 会变成 `portproxy → wslrelay → WSL`，多一跳，而且**可能指回自己形成环**；
- 它通常占着 `0.0.0.0:3080`（`localhost:3080` 才能通），所以也不一定非用 3080 这个端口号。

正确做法是**直连 WSL 网卡地址**（脚本就是这么做的）。一条命令即可，不用试探端口占用：

```powershell
$wsl = (wsl -- hostname -I).Split()[0]     # 例：172.29.220.113
netsh interface portproxy add v4tov4 listenport=3081 listenaddress=0.0.0.0 connectport=3080 connectaddress=$wsl
New-NetFirewallRule -DisplayName "DSH Web GUI (LAN)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3081 -Profile Any
Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private   # 网络若被标成"公用"才需要
```

> 脚本会检测 WSL 是否处于**镜像网络模式**：那种模式下 WSL 与 Windows 共用地址，转发目标会等于 Windows 自己的地址、必然成环，脚本会直接报错让你改用 `http://<windows-lan-ip>:3080/`。

### 为什么走 Windows 转发，而不是直接用 WSL 的 IP

因为 WSL2 的地址是 NAT 内部地址，你的 BOOX / 手机在 `10.1.1.x` 网段，**没有路由能到 `172.29.x.x`**。
数据必须从 Windows 这块真实网卡进来，再由 Windows 转交给 WSL。
（WSL 里 `npm run serve:web` 的 8790 之所以别的设备能开，是因为它直接绑了 `0.0.0.0` 且由 Windows 转发进来，原理相同。）

## 七、验收

按顺序验，每步都有明确的预期：

| 步骤 | 命令 / 操作 | 预期 |
|---|---|---|
| 1 | WSL 里 `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/` | `401`（服务活着） |
| 2 | WSL 里 `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: 10.1.1.69:3081' http://127.0.0.1:3080/api` | `401` = 围栏放行；`403` = `--trusted-host` 没生效 |
| 3 | Windows 上脚本的 self-check | `OPEN` |
| 4 | 另一设备浏览器打开 `http://10.1.1.69:3081/?token=<token>` | 进入界面；地址栏随后变成不带 token 的干净地址（token 换成了 cookie） |

第 2 步是**最省事的判定点**：它把「网络通不通」和「信任配置对不对」分开。实测过，未登记的 Host 一定是 403，伪造域名（如 `evil.example.com`）也是 403 —— 那条 403 正是防 DNS rebinding 的围栏在起作用。

## 八、排错

| 症状 | 原因 | 处理 |
|---|---|---|
| 连不上 / 拒绝连接 | WSL IP 变了（重启过 WSL） | 重跑 `windows-lan-forward.ps1` |
| `dsh: command not found` | `dsh` 只是 npx 缓存，没装成命令 | 见第二节：装启动器，或用完整路径 |
| `EROFS` / `Permission denied` 写 profile | 用 `yuban` 身份跑了（`/root` 是 `0700`） | 必须 `sudo`，见第二节 |
| 设置改完刷新就没了 | 非回环页面，`isLoopback` 判为 false | 属预期能力范围：改走方案 A，或用 `localhost` 打开 |
| 页面能开但一直重连、报 `connection lost` | 先查控制台有无 UUID 异常；本版本已有 `getRandomValues` 回退 | 抓 `/api/host.describe` 是否真的发出（见文末来源） |
| 页面能开但 `/api` 一直 403 | `--trusted-host` 的值和你浏览器地址栏的主机名不一致 | 让两者逐字一致（含 `10.` / `192.168.` 前缀）；或用 `-RemoteAddress` 填网段 |
| 打开是 401 / `unauthorized` | 没带 token，或 token 过期（dsh 重启过） | 用启动时打印的完整 URL，重新复制 token |
| Windows 的 3080 建转发报端口占用 | Windows 已有 WSL localhost 转发占着 | 用脚本默认行为（自动退到 3081），或显式 `-ExternalPort 3081` |
| 别的设备仍进不来 | 防火墙把网络判成了"公用" | `Get-NetConnectionProfile \| Set-NetConnectionProfile -NetworkCategory Private` |
| 手机连不上但电脑能连 | 手机在访客 WiFi / 不同网段 | 确认同一网段 |
| **重启后转发失效，但 `portproxy show all` 还显示规则** | 规则在注册表里，**监听器重启后不会自动重新初始化**；且 WSL 的 NAT 地址已变 | 重跑脚本，或按下一节注册登录任务 |

### 重启后为什么必须重跑

这不是脚本的问题，是 Windows 的已知行为。微软官方 Q&A 里作者的诊断：

> 虽然端口代理的配置仍然存在，但**监听器在系统重启后不会自动重新初始化，直到 IP Helper 服务刷新**，这就是为什么重启该服务或重新执行命令可以解决问题。

来源：[用 netsh interface portproxy 命令设置的端口代理在系统重启后失效](https://learn.microsoft.com/zh-cn/answers/questions/5619284/netsh-interface-portproxy)

两个叠加的原因，缺一个都够呛：

1. **监听器没起来** —— `netsh interface portproxy show all` 有规则 ≠ 端口在 listening。脚本因此不只看规则表，而是真的去查端口有没有在听，没有就重启一次 `iphlpsvc` 再补一遍。
2. **WSL 的 IP 变了** —— 重启后 WSL 是新的 NAT 地址，旧规则里的 `connectaddress` 指向一个不存在的地址。所以必须用当前 IP 重建规则，光"恢复"旧规则没用。

想一劳永逸，注册一个登录时自动重跑的定时任务（脚本自带开关）：

```powershell
# 管理员 PowerShell，第一次跑时加上这个开关
.\windows-lan-forward.ps1 -LanIp 10.1.1.69 -RegisterLogonTask
```

它注册一个以 SYSTEM 身份、最高权限、在**每次登录时**触发的任务。脚本本身是幂等的（删了再建、防火墙规则已存在就复用），所以重复执行安全。

删除它：

```powershell
Unregister-ScheduledTask -TaskName "DSH Web GUI LAN forward" -Confirm:$false
```

> 注意：任务在**登录时**跑，那时 WSL 可能还没起来。脚本会等最多 60 秒（`-WslTimeoutSeconds` 可调）直到 `wsl -- hostname -I` 有回应。
> 另外它不覆盖"Windows 不重启、只重启 WSL"的情况（比如 `wsl --shutdown` 之后）——那种情况下 IP 也会变，得手动重跑一次。

**收工后记得关掉暴露面**（转发和防火墙规则不会自己消失）：

```powershell
netsh interface portproxy delete v4tov4 listenport=3081 listenaddress=0.0.0.0
Remove-NetFirewallRule -DisplayName "DSH Web GUI (LAN, TCP 3081)"
```

## 九、只在 Windows 本机用 / 异地访问

1. **只在 Windows 本机用**：不用改任何配置，Windows 浏览器直接开 `http://127.0.0.1:3080/`。
   但注意 token：从 WSL 终端里复制那条带 `?token=` 的完整 URL 再打开，否则 401。
   Windows 上的 `localhost:3080` 能不能通，取决于 WSL 的 localhost 转发是否生效——取决于网络模式。
2. **异地/公网访问**：**绝不**把 3080 映射到公网。官方态度同样是拒绝直接暴露；用 Tailscale 之类的私有网络
   或方案 A 的 SSH 转发，服务始终只绑回环。
3. **社区已有加固方案**：不想自己搭认证网关的话，社区有 [xgone/dsh-remote](https://github.com/xgone/dsh-remote)（登录、MFA、角色权限、远程文件预览）与 [dsh-web-remote-access](https://dshbase.com/zh/plugins/dsh-web-remote-access/) 这类插件。用之前请自行审查来源与权限。

## 十、安全边界（请读一遍）

- DSH 会话**带完整 shell 权限**。拿到那个带 token 的 URL 的人，等于拿到了这台机器上的命令执行。别把 URL 贴到群里或截图里。
- 局域网里任何设备只要拿到 token 就能用；`--trusted-host` 只解决 Host 围栏，**不是身份认证**（官方原文如此）。
- 非回环页面还会丢设置持久化（见第零节），这不是 bug 而是有意的能力范围划分。
- 想缩小暴露面：用 `-RemoteAddress 10.1.1.0/24` 限制来源网段，不用时按第八节清理规则。
- 别去改 WSL 的 NAT 模式或把 `portproxy` 指向 `0.0.0.0` 之外的接口来"图方便"——那会让转发器监听到不该监听的网卡上。
- **别改 `isTrustedApiRequest()` 或加 `--trusted-host` 来掩盖权限问题**：官方手册明确反对，围栏是防线的一部分。

---

## 附：来源与本地核验

官方（随包发布，也是本站文档的真源）：

- [`@deepseek-ai/dsh-web-app/README.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.zh.md) —— 「LAN 访问与可信主机」「通过 SSH 运行」「已知限制」三节就写在里面；本地路径 `node_modules/@deepseek-ai/dsh-web-app/README.zh.md`
- [`docs/subsystems/web-server.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-server.md) —— Web 载体暴露契约
- [`@deepseek-ai/dsh-client-connection`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/connection/README.md) —— Host/Origin 围栏与 token 交换
- 官方在线站点：<https://deepseek-harness.github.io/deepseek-harness/>

社区（**非官方**，本文件引用处均已在本机源码核对）：

- [deepseek-harness-handbook：远程 Web 访问与安全上下文](https://github.com/sandbaseai/deepseek-harness-handbook/blob/main/docs/en/troubleshooting/remote-web-secure-context.md)（`verified_at: 2026-08-27`，对标 rc.7/rc.8）

本机（0.2.0-rc.2）核验结论：

| 手册说法（rc.7/rc.8） | 本版本实测 |
|---|---|
| 存在「回环钉死的特权方法集」，`host.pickDirectory` 等被单独拒绝 | **不成立**：`/api` 只按 Host 围栏判定，未登记 Host 一律 403、回环一律 401，无方法级差异 |
| 非 HTTPS 来源上 typed RPC 会因 `crypto.randomUUID` 缺失而抛错 | **不成立**：本版本已有 `randomUuid()` → `crypto.getRandomValues()` 回退（`dsh-client-connection/lib/client.js:1190`），全库无未加保护的 `crypto.randomUUID` 调用 |
| 非回环页面 Settings 不可用 | **成立**：`isLoopback` 在本版本只有两个消费点，均使设置降级为内存态（见第零节的源码引用） |

