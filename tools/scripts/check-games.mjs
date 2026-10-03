/**
 * 新游戏接入完整性守卫。
 *
 * 由来：加一款游戏要在 5 处接入（别名 / workspace 链接 / library 登记 / 首页字形 / 跨游戏契约测试），
 * 本会话里这几步漏过多次（漏了页面就看不到游戏，或漏了契约测试就少一道防线）。
 * 人工清单靠不住，这里逐条检查。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8')
const games = readdirSync(`${ROOT}packages/games`, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

const library = read('apps/web/src/library.ts')
const contract = read('packages/ui/test/games-contract.test.ts')
const tsconfig = read('tsconfig.json')
const vitest = read('vitest.config.ts')
const glyphs = read('packages/ui/src/screens/LibraryScreen.tsx')
const problems = []

for (const id of games) {
  const pkgPath = `packages/games/${id}/package.json`
  if (!existsSync(`${ROOT}${pkgPath}`)) { problems.push(`${id}: 缺 package.json`); continue }
  const pkg = JSON.parse(read(pkgPath))
  const name = pkg.name
  if (!name?.startsWith('@eink/')) problems.push(`${id}: 包名应为 @eink/*，实际 ${name}`)
  if (!pkg.dependencies?.['@eink/core']) problems.push(`${id}: 缺少 @eink/core 依赖`)

  // 1) 别名（tsc 与 vitest 各一处）
  if (!tsconfig.includes(`"${name}"`)) problems.push(`${id}: tsconfig.json paths 里没有 ${name}`)
  if (!vitest.includes(`'${name}'`)) problems.push(`${id}: vitest.config.ts alias 里没有 ${name}`)
  // 2) workspace 链接（npm install 之后才会有）
  if (!existsSync(`${ROOT}node_modules/${name}`)) problems.push(`${id}: node_modules/${name} 不存在（需要 npm install）`)
  // 3) library 登记
  if (!library.includes(name)) problems.push(`${id}: apps/web/src/library.ts 未登记`)
  // 4) 首页字形
  // 键可能是标识符（maze:）也可能是引号字符串（'2048':），两种都要认
  const glyphKey = new RegExp(`(^|[\\s{,])['"]?${id}['"]?\\s*:`, 'm')
  if (!glyphKey.test(glyphs)) problems.push(`${id}: LibraryScreen 的 hostGlyph 没有 ${id}`)
  // 5) 跨游戏契约测试
  if (!contract.includes(name)) problems.push(`${id}: games-contract.test.ts 未纳入`)
  // 6) 中英字典 + 无 Math.random + 有测试
  const i18n = `packages/games/${id}/src/i18n.ts`
  if (!existsSync(`${ROOT}${i18n}`)) problems.push(`${id}: 缺 src/i18n.ts`)
  else {
    const dict = read(i18n)
    if (!/Zh\b|zh|Zh:/.test(dict) || !/En\b|en/.test(dict)) problems.push(`${id}: i18n.ts 里中英字典不全`)
  }
  /*
   * 检查真实调用而不是字面出现：本项目各游戏的注释里普遍写着「绝不使用 Math.random」，
   * 直接 grep 字面量会全部误报 —— 误报一旦出现，守卫很快就会被无视。
   * 因此先剔除块注释与行注释，再找调用形式（Math.random( / Date.now(）。
   */
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const file of readdirSync(`${ROOT}packages/games/${id}/src`)) {
    const code = stripComments(read(`packages/games/${id}/src/${file}`))
    if (/Math\.random\s*\(/.test(code)) {
      problems.push(`${id}/src/${file}: 调用了 Math.random（游戏内随机必须用 createRng）`)
    }
    if (/Date\.now\s*\(/.test(code)) {
      problems.push(`${id}/src/${file}: 调用了 Date.now（会破坏可重放性）`)
    }
  }
  const testDir = `packages/games/${id}/test`
  const tests = existsSync(`${ROOT}${testDir}`) ? readdirSync(`${ROOT}${testDir}`).filter((f) => f.endsWith('.test.ts')) : []
  if (tests.length === 0) problems.push(`${id}: 没有测试文件`)
}

if (problems.length > 0) {
  console.error(`[check-games] 发现 ${problems.length} 处接入问题：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`[check-games] ${games.length} 款游戏接入完整（别名 / 链接 / 登记 / 字形 / 契约测试 / i18n / 无 Math.random / 有测试）`)
