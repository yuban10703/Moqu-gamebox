#!/usr/bin/env node
/**
 * 硬编码文案扫描。
 *
 * 语言对齐（中英 key 集合一致）由 vitest 里的 dicts 测试负责，这里只做另一件事：
 * 找出源码里**写死的中文文案**——它们会绕过 i18n，导致英文界面漏翻译。
 *
 * 允许的位置：
 *   - packages/core/src/locales/**、**\/i18n.ts（字典本体）
 *   - 测试文件（断言里出现中文是正常的）
 *   - 行内带 `i18n-exempt` 注释的行
 *   - JSDoc/行注释（不参与运行）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const roots = [
  'packages/core/src',
  'packages/platform/src',
  'packages/ui/src',
  'packages/games/sokoban/src',
  'apps/web/src',
  'apps/android/app/src/main/java',
]
const skipPatterns = [/\/locales\//, /\/i18n\.ts$/, /\.test\.tsx?$/, /i18n-exempt/]
const cjk = /[\u4e00-\u9fff]/
const stringLiteral = /(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g

/** @type {Array<{file: string, line: number, text: string}>} */
const violations = []

function scanFile(path) {
  const source = readFileSync(path, 'utf8')
  const lines = source.split('\n')
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    if (skipPatterns.some((pattern) => pattern.test(path))) return
    if (trimmed.includes('i18n-exempt')) return
    // 去掉行尾注释再检查（避免把注释里的中文当成硬编码文案）
    const code = line.replace(/\/\/.*$/, '')
    for (const match of code.matchAll(stringLiteral)) {
      const value = match[2] ?? ''
      if (cjk.test(value)) {
        violations.push({ file: relative(root, path), line: index + 1, text: value.slice(0, 60) })
        break
      }
    }
  })
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === 'build' || name === 'dist') continue
      walk(full)
    } else if (/\.(ts|tsx|kt)$/.test(name)) {
      scanFile(full)
    }
  }
}

for (const entry of roots) {
  try {
    walk(join(root, entry))
  } catch {
    // 目录不存在就跳过（例如只构建 Web 时没有 android 源码）
  }
}

if (violations.length > 0) {
  console.error('[check-i18n] 发现硬编码中文文案（请改为走 i18n key）：')
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.text}`)
  }
  process.exit(1)
}
console.log('[check-i18n] 未发现硬编码中文文案')
