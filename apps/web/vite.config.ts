import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const pkg = (path: string): string =>
  fileURLToPath(new URL(`../../packages/${path}`, import.meta.url))

const webPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string }

/** 构建时刻（本地时间 MM-DD HH:mm）—— 用来一眼判断设备上是不是最新版 */
function buildStamp(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export default defineConfig({
  // 相对路径：既能放静态托管，也能直接打进 APK 的 assets
  base: './',
  /**
   * 构建时注入版本信息：关于页显示，用户据此判断设备上是否为最新版。
   * 只在构建时算一次（运行时算的话刷新一次就变，反而失去意义）。
   */
  define: {
    __BUILD_INFO__: JSON.stringify({ version: webPkg.version, stamp: buildStamp() }),
  },
  plugins: [react()],
  resolve: {
    alias: {
      // 更具体的路径必须排在前面：字符串别名是按顺序做前缀匹配的
      '@eink/ui/styles.css': pkg('ui/src/styles.css'),
      '@eink/core': pkg('core/src/index.ts'),
      '@eink/platform': pkg('platform/src/index.ts'),
      '@eink/sokoban': pkg('games/sokoban/src/index.ts'),
      '@eink/ui': pkg('ui/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  build: {
    /*
     * 按**现代浏览器**构建（用户要求："不用管 kindle 了，完全按照现代浏览器来写"）。
     *
     * 之前这里写的是 ['chrome69','safari12']，理由是"BOOX 的系统 WebView 可能很旧"——
     * 那是**没有实测的防御性猜测**。实测两台正牌设备（devtools 里读 navigator.userAgent + CSS.supports）：
     *   · BOOX P6Plus：Chromium 146 / Android 13
     *   · BOOX NoteX2：Chromium 156 / Android 11
     *   · CSS 变量 / grid / flex gap / :has() / dvh / 容器查询 / color-mix / subgrid 全部支持
     * 所以老引擎降级是不必要的负担：它会白白降级语法、增大产物体积。
     *
     * 现在取"常青浏览器"基线（2023 年前后），对实测设备有巨大余量，
     * 同时不用真正的前沿语法，避免踩到实现差异。
     * 明确不支持：Kindle 自带浏览器（老 WebKit，不支持 ES 模块/CSS 变量/grid，会白屏）。
     */
    target: ['chrome110', 'edge110', 'firefox110', 'safari16'],
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
})
