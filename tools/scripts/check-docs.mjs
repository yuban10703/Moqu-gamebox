/**
 * 文档与现实核对。
 *
 * 由来：交接文档（docs/handover.md）里的命令、路径、游戏数量、测试数量，
 * 一旦与现实不符就成了误导 —— 而这类漂移极难被人工发现（本会话已多次遇到"文档说 N 款/又说 M 款"）。
 * 这里把它变成可执行检查，接入 npm run verify，漂移即失败。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const doc = readFileSync(`${ROOT}docs/handover.md`, 'utf8')
const scripts = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')).scripts
const problems = []

// 1) 文档提到的 npm 脚本必须都存在
for (const name of new Set([...doc.matchAll(/npm run ([a-z:-]+)/g)].map((m) => m[1]))) {
  if (!(name in scripts)) problems.push(`文档提到 npm run ${name}，但 package.json 里没有`)
}

// 2) 文档提到的仓库路径必须存在（跳过 <id> 这类占位符）
for (const raw of new Set([...doc.matchAll(/`((?:packages|tools|apps|docs)\/[^`]+)`/g)].map((m) => m[1]))) {
  const target = raw.split(/\s|（/)[0]
  if (target.includes('<')) continue
  if (!existsSync(`${ROOT}${target}`)) problems.push(`文档提到路径 ${target}，但仓库里没有`)
}

// 3) 游戏数量必须与实际包数一致
const games = readdirSync(`${ROOT}packages/games`, { withFileTypes: true }).filter((e) => e.isDirectory()).length
const claimed = doc.match(/\| 游戏 \| \*\*(\d+) 款\*\* \|/)
if (!claimed) problems.push('检查点里找不到「游戏 | **N 款**」这一行')
else if (Number(claimed[1]) !== games) problems.push(`检查点说 ${claimed[1]} 款游戏，实际 ${games} 个包`)

/*
 * 4) **所有文档**（不只交接文档）里提到的 npm 脚本、仓库路径、文档链接都必须存在。
 *
 * 由来：用户发现「docs 里有的 md 和项目实际情况已经不一样了，比如 chrome69 兼容，我们早就放弃了」——
 * 之前只有 handover.md 被核对，别的 md 里写着已删除的文件、改名过的脚本、早就换掉的构建目标都没人管。
 * 这里做的是**机械可验**的那一半（脚本名、路径、链接）；语义性的陈旧说法（例如把历史决策写成现状）
 * 仍然只能靠人/审计发现，但至少不会再有"指向不存在的文件"这类硬漂移。
 */
const walkDocs = (dir, prefix = '') => readdirSync(`${ROOT}${dir}`, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory()
    ? walkDocs(`${dir}${e.name}/`, `${prefix}${e.name}/`)
    : e.name.endsWith('.md')
      ? [`${dir}${e.name}`]
      : [],
)
// 递归：docs/ 下的子目录（例如 docs/screens/README.md）也要一起核对
const docs = ['README.md', ...walkDocs('docs/')]

/** 被 .gitignore 排除的路径（构建产物、依赖目录）不算漂移 */
const ignored = (rel) => {
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT })
    return true
  } catch {
    return false
  }
}

for (const rel of docs) {
  const text = readFileSync(`${ROOT}${rel}`, 'utf8')
  // 4a) 文档里的 `npm run xxx`
  for (const name of new Set([...text.matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]))) {
    if (!(name in scripts)) problems.push(`${rel} 提到 npm run ${name}，但 package.json 里没有`)
  }
  // 4b) 仓库路径：反引号里的、以及 markdown 链接里的（跳过占位符、通配、绝对/临时路径）
  const candidates = new Set()
  for (const m of text.matchAll(/`((?:packages|tools|apps|docs)\/[^`]+)`/g)) candidates.add(m[1])
  for (const m of text.matchAll(/\]\(((?:packages|tools|apps|docs)\/[^)#]+)\)/g)) candidates.add(m[1])
  for (const raw of candidates) {
    // 约定：文档里提到**已不存在**的路径时，同一行必须写明「已移除」或「历史」——
    // 这样历史章节（例如 verification.md 的开发日志里那些后来被删掉的游戏包）可以保留，
    // 但不会被误读成现状，也不会让这条检查变成"删了就得改文档"的负担。
    const lineOf = (needle) => text.split('\n').find((l) => l.includes(needle)) ?? ''
    const annotated = (needle) => /已移除|已删除|（历史）|\(历史\)/.test(lineOf(needle))
    const target = raw.split(/[\s（(]/)[0].replace(/[.,;:]$/, '')
    // `...` 是文档里的省略写法（中间层级没写全），不是真实路径
    if (target.includes('...')) continue
    if (target.includes('<') || target.includes('*') || target.endsWith('/')) {
      // 目录引用与占位符：只要求目录存在
      const dir = target.replace(/\/$/, '')
      if (dir.includes('<') || dir.includes('*')) continue
      if (!existsSync(`${ROOT}${dir}`)) problems.push(`${rel} 提到路径 ${dir}，但仓库里没有`)
      continue
    }
    if (ignored(target)) continue
    if (!existsSync(`${ROOT}${target}`) && !annotated(raw)) {
      problems.push(`${rel} 提到路径 ${target}，但仓库里没有（若它确实已移除，请在同一行写明「已移除」）`)
    }
  }
}

if (problems.length > 0) {
  console.error('[check-docs] 文档与现实不一致：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`[check-docs] 一致：${games} 款游戏、${docs.length} 份文档的命令 / 路径 / 链接均有效`)
