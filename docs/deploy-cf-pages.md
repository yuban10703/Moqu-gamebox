# 部署到 Cloudflare Pages

纯静态托管，不需要改动应用代码：产物用相对路径（`base: './'`），既能挂在 `*.pages.dev` 也能挂在子路径/自定义域名下。

## 一、Git 集成（推荐：推代码就自动构建）

Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，填：

| 字段 | 值 |
|---|---|
| 框架预设（Framework preset） | **None**（别选 Vite —— 它假设产物在根目录 `dist/`） |
| 根目录（Root directory） | 留空（仓库根；这是 npm workspaces 单仓，必须在根装依赖） |
| 构建命令（Build command） | `npm run build:web` |
| 构建输出目录（Build output directory） | `apps/web/dist` |
| 环境变量 | `NODE_VERSION` = `24`（仓库里也有 `.nvmrc`；Vite 8 需要 ≥ 20.19 / 22.12） |
| 构建监视路径（可选） | `apps/web/*`、`packages/*`、`package-lock.json` |

- **预览**：所有非生产分支 / PR 自动得到独立预览地址 `https://<分支名>.<项目名>.pages.dev`，不覆盖生产。
- 私有仓库：装 Cloudflare 的 GitHub App 并授权本仓库即可。
- 构建过程就是「全新克隆 → `npm ci`（根目录，自动）→ `npm run build:web`」；已在干净克隆里验证通过（产物约 600 KB）。

## 二、命令行（wrangler）

```bash
# 首次：建项目（生产分支 = main）
npx wrangler pages project create moqu --production-branch=main

# 生产部署 → https://moqu.pages.dev
npm run deploy:cf

# 等价的手写形式（换项目名/分支时用）
npm run build:web && npx wrangler pages deploy apps/web/dist --project-name=moqu --branch=main

# 预览部署（同项目的分支别名，不覆盖生产）→ https://dev.moqu.pages.dev
npm run build:web && npx wrangler pages deploy apps/web/dist --project-name=moqu --branch=dev

# 本地预览（真·Pages 运行时，默认 http://127.0.0.1:8788）
npm run preview:cf
```

非交互（CI）：设 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`；工作树脏时加 `--commit-dirty=true`。

## 三、本项目相关的注意点

- **不需要 `_redirects` / SPA fallback**：应用只用 `history.pushState(state, '')`（`packages/ui/src/App.tsx`），URL 从不变化，刷新永远落在 `/`；加了 fallback 反而会把真正的 404 资源变成 `index.html`。
- **Service Worker 由构建生成**（`tools/scripts/generate-sw.mjs` 自算内容指纹）：Pages 是 HTTPS，离线可用；CF 默认不缓存资源，但 SW 会预缓存全部产物，所以第二次访问起走缓存。
- **存档在 IndexedDB，按域隔离**：本机 `127.0.0.1` 上的进度不会带到线上；要搬就用「设置 → 数据管理 → 导出备份」，在线上导入。
- **语言跟随浏览器**：线上访客自动 zh / en，无需配置。
- `*.pages.dev` 是公开地址；要限制访问用 Cloudflare Access（零信任）挡在前面。
