# 部署到 Cloudflare（Kindle 版）

> **本分支只部署 Kindle 版。** 产物是 `apps/kindle/dist`（纯 ES5 + 遗留 CSS 的静态文件），
> Worker / Pages 项目名用 `moqu-kindle`，不要和现代版共用项目。
> 构建与产物本身的说明见 [kindle.md](kindle.md)。

纯静态站点，不需要改任何代码：产物用相对路径，挂 `*.workers.dev`、`*.pages.dev`、
子路径或自定义域名都能跑。

## 先分清你建的是哪种项目

两者的构建配置完全不同。判断口诀：**日志里出现「Failed: error occurred while running deploy command」，
说明你建的是 Worker**。

| | Workers（Workers Builds） | Pages |
|---|---|---|
| 构建配置里有没有「Deploy command」 | **有**，默认 `npx wrangler deploy` | **没有** —— Cloudflare 自己上传构建输出目录 |
| 需要仓库里有 Wrangler 配置 | **需要**（已提供根 `wrangler.jsonc`），否则 `wrangler deploy` 会去尝试"自动配置"并试图开 PR，构建直接失败 | 不需要 |

## 一、Workers（Workers Builds）

仓库根已放好 `wrangler.jsonc`：`name = moqu-kindle`、`assets.directory = ./apps/kindle/dist`、纯静态无 Worker 脚本。
Dashboard 上：

| 字段 | 值 |
|---|---|
| 构建命令（Build command） | `npm run build:kindle` —— **必填**：这是"可选"字段，留空会直接跳到部署，报 `assets.directory ... does not exist` |
| 部署命令（Deploy command） | 留默认 `npx wrangler deploy` |
| 预览命令（Preview command） | 留默认 `npx wrangler preview`（非生产分支的预览构建用它；也可改成 `npx wrangler versions upload` 拿版本 URL） |
| 根目录（Root directory） | 留空（npm workspaces 单仓，依赖必须在根装） |
| 构建变量 | 一般不用设：镜像默认 Node 24.18，且会读仓库根的 `.nvmrc`（写了 `24`）。要固定则设 `NODE_VERSION=24` |

**`wrangler.jsonc` 里的 `name` 必须与你 Cloudflare 上那个 Worker 同名**（现为 `moqu-kindle`），
否则会去部署/新建另一个 Worker。

**只保留一个 Wrangler 配置**：本仓库用 `wrangler.jsonc`，不要再加 `wrangler.toml`（两个同时存在 wrangler 会直接报错）。

## 二、Pages

Pages 的构建配置里只有「构建命令 + 构建输出目录」，没有部署命令（Cloudflare 读构建命令的退出码，成功后自己上传产物）：

| 字段 | 值 |
|---|---|
| 生产分支（Production branch） | `kindle` |
| 框架预设 | **None**（别选 Vite —— 它假设产物在根目录 `dist/`） |
| 根目录 | 留空 |
| 构建命令 | `npm run build:kindle` |
| 构建输出目录 | `apps/kindle/dist` |
| 环境变量 | `NODE_VERSION` = `24` |

非生产分支 / PR 自动得到预览地址 `https://<分支名>.moqu-kindle.pages.dev`，不覆盖生产。

**这一个不要开 SPA 回退（Single-page application fallback）**：站点是多页静态，
`/check.html` 是零依赖的设备自检页，必须靠真实路径访问到；开了回退只会把 404 变成首页。

产物文件名**没有内容哈希**（`kindle.js` / `kindle.css` 名字固定），Pages 默认的长缓存会让
"重新部署了但设备上还是旧版"。构建时已带一个 `_headers`（源文件在 `apps/kindle/public/_headers`），
把所有响应设成 `max-age=0, must-revalidate`：没变就是一次廉价的 304，变了立刻生效。

## 三、命令行（本地 / CI，两种项目都适用）

```bash
# 构建
npm run build:kindle

# 本地预览（不经过 Cloudflare，最省事 → http://<局域网IP>:8791）
npm run serve:kindle

# 本地预览（真·Cloudflare 运行时；Worker 路线走 wrangler dev → http://127.0.0.1:8787）
npm run preview:cf

# 本地预览（Pages 路线，用 Pages 的运行时）
npm run build:kindle && npx wrangler pages dev apps/kindle/dist

# 部署（本地/CI 手动；Workers 路线）
npx wrangler deploy

# 部署（本地/CI 手动；Pages 路线）
npm run deploy:cf     # = build:kindle + wrangler pages deploy apps/kindle/dist --project-name=moqu-kindle --branch=kindle
```

首次用 Pages 命令行要先建项目：

```bash
npx --yes wrangler pages project create moqu-kindle --production-branch=kindle
```

非交互（CI）：设 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`；工作树脏时加 `--commit-dirty=true`。

## 四、踩过的坑（都真实发生过）

1. **日志「Failed: error occurred while running deploy command」**：说明项目建成了 **Worker**，
   而仓库里没有 `wrangler.jsonc` —— 默认的 `npx wrangler deploy` 找不到配置，会去尝试
   "自动配置"（在 Builds 环境里会失败）。拉最新代码重试构建即可。
2. **`✘ [ERROR] The directory specified by the "assets.directory" field ... does not exist`**：
   构建步骤没产出产物。Build command 是选填的，留空时 Cloudflare 只跑部署命令，
   于是找不到 `apps/kindle/dist`。**把构建命令填成 `npm run build:kindle`** 即可；
   实在不想填两个字段，也可以把部署命令写成 `npm run build:kindle && npx wrangler deploy`。
   依赖不用自己装：不设 `SKIP_DEPENDENCY_INSTALL` 时 Cloudflare 会自动执行安装。
3. **`compatibility_date` 不能写未来日期**：写成本机"今天"时 wrangler 直接报
   `Compatibility date ... is in the future and unsupported`。纯静态资源用不到新行为，
   所以固定用一个过去日期（当前 `2025-04-01`）。

## 五、Kindle 版特有的注意点

- **部署完先开 `/check.html`，不要先开首页**：它零依赖（无 CSS、无脚本引入），
  主应用跑不起来时照样能用。能打开就说明 TLS / 网络 / 渲染链路是通的；
  很老的 Kindle 上 HTTPS 本身可能就是第一道坎，那与我们的代码无关，但表现同样是"打不开"。
  自检页底部会生成一段可直接选中复制的报告，排障时靠它。
- **存档在 localStorage，按域隔离**：本机 `127.0.0.1` 或局域网 IP 上的进度不会带到线上，
  换域名也一样。要搬用设置页的「导出」，在另一端导入（信封格式与 Web/Android 版一致）。
- **没有 Service Worker**：老引擎多半不支持，而且这一版是单包加载、本来就离线可用
  （Kindle 断网后产物已在浏览器缓存里）。所以线上部署**不需要**任何 SW 相关配置。
- **语言跟随浏览器**，也可在设置里手动切换（设置存在 localStorage）。
- 要限制访问（`*.workers.dev` / `*.pages.dev` 都是公开地址），用 Cloudflare Access 挡在前面。
