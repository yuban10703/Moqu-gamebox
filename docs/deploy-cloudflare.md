# 部署到 Cloudflare（Workers 或 Pages）

纯静态站点，不需要改应用代码：产物用相对路径（`base: './'`），挂 `*.workers.dev`、`*.pages.dev`、子路径或自定义域名都能跑。

> **先分清你建的是哪种项目** —— 两者的构建配置完全不同，日志里出现
> 「Failed: error occurred while running **deploy command**」说明你建的是 **Worker**：
>
> | | Workers（Workers Builds） | Pages |
> |---|---|---|
> | 构建配置里有没有「Deploy command」 | **有**，默认 `npx wrangler deploy` | **没有** —— Cloudflare 自己上传构建输出目录 |
> | 需要仓库里有 Wrangler 配置 | **需要**（见下），否则 `wrangler deploy` 会去尝试"自动配置"并试图开 PR，构建直接失败 | 不需要 |
> | 配置文件 | 仓库根 `wrangler.jsonc`（已提供） | 无 |
>
> **不要把 `npm run deploy:cf` 填进 Dashboard 的 Deploy command 字段** —— 那个脚本是给你本地/CI 手动部署用的；
> 在 Builds 环境里再跑一次 `wrangler pages deploy` 只会把生产环境重复部署一遍（而且 Worker 项目里根本没有 Pages 项目，必然失败）。

## 一、Workers（Workers Builds）

仓库根已放好 `wrangler.jsonc`（`assets.directory = ./apps/web/dist`，纯静态、无 Worker 脚本）。Dashboard 上：

| 字段 | 值 |
|---|---|
| 构建命令（Build command） | `npm run build:web` |
| 部署命令（Deploy command） | 留默认 `npx wrangler deploy` |
| 预览命令（Preview command） | 留默认 `npx wrangler preview`（非生产分支的预览构建用它；也可改成 `npx wrangler versions upload` 拿版本 URL） |
| 根目录（Root directory） | 留空（npm workspaces 单仓，依赖必须在根装） |
| 构建变量 | `NODE_VERSION` = `24`（仓库里也有 `.nvmrc`；Vite 8 需要 ≥ 20.19 / 22.12） |
| 构建监视路径（可选） | `apps/web/*`、`packages/*`、`package-lock.json` |

**`wrangler.jsonc` 里的 `name` 必须与你 Cloudflare 上那个 Worker 同名**（现为 `moqu`），否则会去部署/新建另一个 Worker。

## 二、Pages

Pages 的构建配置里只有「构建命令 + 构建输出目录」，没有部署命令（Cloudflare 读构建命令的退出码，成功后自己上传产物）：

| 字段 | 值 |
|---|---|
| 框架预设 | **None**（别选 Vite —— 它假设产物在根目录 `dist/`） |
| 根目录 | 留空 |
| 构建命令 | `npm run build:web` |
| 构建输出目录 | `apps/web/dist` |
| 环境变量 | `NODE_VERSION` = `24` |

非生产分支 / PR 自动得到预览地址 `https://<分支名>.<项目名>.pages.dev`，不覆盖生产。

## 三、命令行（本地 / CI，两种项目都适用）

```bash
# 构建
npm run build:web

# 本地预览（真·Cloudflare 运行时；Worker 路线走 wrangler dev → http://127.0.0.1:8787）
npm run preview:cf

# 本地预览（Pages 路线，用 Pages 的运行时 → http://127.0.0.1:8788）
npm run build:web && npx wrangler pages dev apps/web/dist

# 部署（本地/CI 手动；Workers 用这个）
npx wrangler deploy

# 部署（本地/CI 手动；Pages 用这个）
npm run deploy:cf     # = build:web + wrangler pages deploy apps/web/dist --project-name=moqu --branch=main

# Pages 分支预览部署 → https://dev.moqu.pages.dev
npm run build:web && npx wrangler pages deploy apps/web/dist --project-name=moqu --branch=dev
```

首次用 Pages 命令行要先建项目：`npx wrangler pages project create moqu --production-branch=main`。
非交互（CI）：设 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`；工作树脏时加 `--commit-dirty=true`。

## 四、踩过的两个坑（都真实发生过）

1. **日志「Failed: error occurred while running deploy command」**：说明项目建成了 **Worker**，
   而仓库里当时没有 `wrangler.jsonc` —— 默认的 `npx wrangler deploy` 找不到配置，会去尝试
   "自动配置"（在 Builds 环境里会失败）。现在根目录已有 `wrangler.jsonc`，拉最新代码重试构建即可。
2. **`compatibility_date` 不能写未来日期**：写成本机"今天"（2026-10-05）时 wrangler 直接报
   `Compatibility date ... is in the future and unsupported`。本项目是纯静态资源、没有 Worker 脚本，
   用不到任何新行为，所以固定用一个过去日期（当前 `2025-04-01`）。

## 五、本项目相关的注意点

- **不需要 `_redirects` / SPA fallback**：应用只用 `history.pushState(state, '')`（`packages/ui/src/App.tsx`），URL 从不变化，刷新永远落在 `/`；加了 fallback 反而会把真正的 404 资源变成 `index.html`。
- **Service Worker 由构建生成**（`tools/scripts/generate-sw.mjs` 自算内容指纹）：线上是 HTTPS，离线可用；Cloudflare 默认不缓存资源，但 SW 会预缓存全部产物。
- **存档在 IndexedDB，按域隔离**：本机 `127.0.0.1` 上的进度不会带到线上；要搬就用「设置 → 数据管理 → 导出备份」，在线上导入。
- **语言跟随浏览器**：线上访客自动 zh / en，无需配置。
- 要限制访问（`*.workers.dev` / `*.pages.dev` 都是公开地址），用 Cloudflare Access 挡在前面。
