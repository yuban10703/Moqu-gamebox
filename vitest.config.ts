import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const pkg = (p: string) => fileURLToPath(new URL(`./packages/${p}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@eink/core': pkg('core/src/index.ts'),
      '@eink/sokoban': pkg('games/sokoban/src/index.ts'),
      '@eink/sudoku': pkg('games/sudoku/src/index.ts'),
      '@eink/reversi': pkg('games/reversi/src/index.ts'),
      '@eink/fifteen': pkg('games/fifteen/src/index.ts'),
      '@eink/gomoku': pkg('games/gomoku/src/index.ts'),
      '@eink/memory': pkg('games/memory/src/index.ts'),
      '@eink/connect4': pkg('games/connect4/src/index.ts'),
      '@eink/minesweeper': pkg('games/minesweeper/src/index.ts'),
      '@eink/2048': pkg('games/2048/src/index.ts'),
      '@eink/ui': pkg('ui/src/index.ts'),
      '@eink/platform': pkg('platform/src/index.ts'),
    },
  },
  test: {
    // 默认 node 环境（规则、存档协议、布局纯函数）；
    // 需要 DOM 的测试在文件头部用 `// @vitest-environment jsdom` 单独声明。
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'packages/**/test/**/*.test.tsx'],
    testTimeout: 20000,
  },
})
