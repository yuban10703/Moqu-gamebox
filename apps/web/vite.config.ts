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
   * 构建时注入版本信息：首页页脚右下角显示，用户据此判断设备上是否为最新版。
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
    // BOOX 上的系统 WebView 可能很旧：语法按 chrome69 降级，避免白屏
    target: ['chrome69', 'safari12'],
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
})
