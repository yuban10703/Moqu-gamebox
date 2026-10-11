/**
 * ES5 语法守卫：用 TypeScript 自己的解析器把产物解析成 AST，
 * 遇到任何「ES5 之后才存在的**语法**」就报错。
 *
 * 为什么需要它，而不是"相信编译器"：
 * - 目标设备是 Kindle 自带浏览器（老 WebKit）。它遇到不认识的语法是**整段脚本不执行**，
 *   表现和"什么都没发生"一样 —— 用户只看到白屏，连报错都没有；
 * - 工具链里 Vite 8 / rolldown 明确不支持 ES2015 以下，整个 ES5 只能靠 tsc 的 downlevel；
 *   而 tsc 的 downlevel 会不会漏、我们手写的 polyfills.js / amd-shim.js 有没有混进新语法，
 *   都需要一个**机械的**判据，不能靠人眼 review。
 *
 * 用法：
 *   node tools/scripts/check-es5.mjs <file.js> [more.js ...]
 * 退出码 0 = 全部干净；1 = 有违规（打印文件名、行号、违规节点）。
 */
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/** 逐字节禁止的语法节点（ES5 里不存在的东西） */
const FORBIDDEN = new Map([
  [ts.SyntaxKind.ArrowFunction, '箭头函数 =>'],
  [ts.SyntaxKind.ClassDeclaration, 'class 声明'],
  [ts.SyntaxKind.ClassExpression, 'class 表达式'],
  [ts.SyntaxKind.TemplateExpression, '模板字符串 `'],
  [ts.SyntaxKind.NoSubstitutionTemplateLiteral, '模板字符串 `'],
  [ts.SyntaxKind.SpreadElement, '展开 ...'],
  [ts.SyntaxKind.SpreadAssignment, '剩余/展开 ...'],
  [ts.SyntaxKind.ShorthandPropertyAssignment, '对象属性简写 { a }'],
  [ts.SyntaxKind.AwaitExpression, 'await'],
  [ts.SyntaxKind.BigIntLiteral, 'BigInt 字面量'],
  [ts.SyntaxKind.OptionalChain, '可选链 ?.'],
  [ts.SyntaxKind.NonNullExpression, '非空断言 !'],
])

export function findEs5Violations(fileName, source) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES5, true, ts.ScriptKind.JS)
  const violations = []

  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const snippetOf = (node) =>
    source.slice(node.getStart(sf), node.getStart(sf) + 60).replace(/\s+/g, ' ')

  function walk(node) {
    const forbidden = FORBIDDEN.get(node.kind)
    if (forbidden) {
      violations.push({ line: lineOf(node), kind: forbidden, snippet: snippetOf(node) })
    }

    // let / const
    if (ts.isVariableDeclarationList(node) && (node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
      violations.push({
        line: lineOf(node),
        kind: node.flags & ts.NodeFlags.Const ? 'const 声明' : 'let 声明',
        snippet: snippetOf(node),
      })
    }

    // 生成器 function*
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.asteriskToken) {
      violations.push({ line: lineOf(node), kind: '生成器 function*', snippet: snippetOf(node) })
    }

    // 指数运算符 **
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken) {
      violations.push({ line: lineOf(node), kind: '指数运算符 **', snippet: snippetOf(node) })
    }

    // 对象字面量里的计算属性名
    if (ts.isPropertyAssignment(node) && ts.isComputedPropertyName(node.name)) {
      violations.push({ line: lineOf(node), kind: '计算属性名 {[k]:v}', snippet: snippetOf(node) })
    }
    if (ts.isMethodDeclaration(node) && ts.isComputedPropertyName(node.name)) {
      violations.push({ line: lineOf(node), kind: '计算属性名（方法）', snippet: snippetOf(node) })
    }

    // 形参默认值 / 解构形参
    if (ts.isParameter(node)) {
      if (node.initializer) {
        violations.push({ line: lineOf(node), kind: '默认参数', snippet: snippetOf(node) })
      }
      if (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) {
        violations.push({ line: lineOf(node), kind: '解构形参', snippet: snippetOf(node) })
      }
    }

    // 解构声明
    if (ts.isVariableDeclaration(node) && (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name))) {
      violations.push({ line: lineOf(node), kind: '解构声明', snippet: snippetOf(node) })
    }

    ts.forEachChild(node, walk)
  }

  walk(sf)
  return violations
}

/** 便捷入口：给一批文件，返回 `Map<文件名, 违规[]>`（只含真的有问题的文件） */
export function checkFiles(files) {
  const problems = new Map()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const violations = findEs5Violations(file, source)
    if (violations.length > 0) problems.set(file, violations)
  }
  return problems
}

// CLI：node tools/scripts/check-es5.mjs <file...>
if (process.argv[1] && process.argv[1].endsWith('check-es5.mjs')) {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('用法: node tools/scripts/check-es5.mjs <file.js> [more.js ...]')
    process.exit(2)
  }
  const problems = checkFiles(files)
  if (problems.size === 0) {
    for (const file of files) console.log(`ES5 干净 ✅  ${file}`)
    process.exit(0)
  }
  for (const [file, violations] of problems) {
    console.error(`\n❌ ${file} 有 ${violations.length} 处 ES5 之后的语法：`)
    for (const violation of violations.slice(0, 20)) {
      console.error(`   - 第 ${violation.line} 行 [${violation.kind}] ${violation.snippet}`)
    }
    if (violations.length > 20) console.error(`   …… 还有 ${violations.length - 20} 处`)
  }
  process.exit(1)
}
