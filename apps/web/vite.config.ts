import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const pkg = (path: string): string =>
  fileURLToPath(new URL(`../../packages/${path}`, import.meta.url))

export default defineConfig({
  // 相对路径：既能放静态托管，也能直接打进 APK 的 assets
  base: './',
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
