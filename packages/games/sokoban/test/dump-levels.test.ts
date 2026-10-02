/**
 * 关卡包生成工具（不是测试，是 codegen）。
 *
 * 用法：npm run gen:levels
 * 行为：按下面的 PackSpec 调 `buildLevel`，把结果写进 src/levels.ts。
 * 平时不执行（DUMP_LEVELS 未设置时整个套件被跳过），因此不会污染常规测试。
 *
 * 关卡来源说明（对应 A03）：
 * - 房间模板是自绘的（src/level.ts 的 ROOM_TEMPLATES）；
 * - 关卡由固定种子反向拉动生成，天然可解；
 * - 生成结果连同 seed/unpushSteps 一起写进 levels.ts 的 source 字段，
 *   由 test/levels.test.ts 复算比对并独立求解复核。
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROOM_TEMPLATES, type LevelDef } from '../src/level.js'
import { buildLevel, type PackSpec } from '../src/generate.js'

const ENABLED = process.env.DUMP_LEVELS === '1'

const SPECS: PackSpec[] = [
  // 入门：2–4 次推动
  { id: 'L01', roomId: 'nook', difficulty: 'starter', unpushSteps: 2, seeds: [1001, 1002, 1003] },
  { id: 'L02', roomId: 'nook', difficulty: 'starter', unpushSteps: 3, seeds: [1011, 1012] },
  { id: 'L03', roomId: 'twin', difficulty: 'starter', unpushSteps: 3, seeds: [1021, 1022] },
  { id: 'L04', roomId: 'twin', difficulty: 'starter', unpushSteps: 4, seeds: [1031, 1032] },
  { id: 'L05', roomId: 'island', difficulty: 'starter', unpushSteps: 4, seeds: [1041, 1042] },
  { id: 'L06', roomId: 'pillars', difficulty: 'starter', unpushSteps: 4, seeds: [1051, 1052] },
  // 熟练：6 次推动
  { id: 'L07', roomId: 'twin', difficulty: 'skilled', unpushSteps: 6, seeds: [2001, 2002] },
  { id: 'L08', roomId: 'island', difficulty: 'skilled', unpushSteps: 6, seeds: [2011, 2012] },
  { id: 'L09', roomId: 'pillars', difficulty: 'skilled', unpushSteps: 6, seeds: [2021, 2022] },
  { id: 'L10', roomId: 'pockets', difficulty: 'skilled', unpushSteps: 6, seeds: [2031, 2032] },
  { id: 'L11', roomId: 'hall', difficulty: 'skilled', unpushSteps: 6, seeds: [2041, 2042] },
  // 挑战：8–10 次推动
  { id: 'L12', roomId: 'island', difficulty: 'challenging', unpushSteps: 8, seeds: [3001, 3002] },
  { id: 'L13', roomId: 'pillars', difficulty: 'challenging', unpushSteps: 8, seeds: [3011, 3012] },
  { id: 'L14', roomId: 'pockets', difficulty: 'challenging', unpushSteps: 8, seeds: [3021, 3022] },
  { id: 'L15', roomId: 'hall', difficulty: 'challenging', unpushSteps: 8, seeds: [3031, 3032] },
  { id: 'L16', roomId: 'hall', difficulty: 'challenging', unpushSteps: 10, seeds: [3041, 3042] },
]

function roomGrid(roomId: string): string[] {
  const room = ROOM_TEMPLATES.find((candidate) => candidate.id === roomId)
  if (!room) throw new Error(`unknown room ${roomId}`)
  return room.grid
}

interface Built {
  def: LevelDef
  witness: string[]
}

function renderLevelsModule(built: Built[]): string {
  const defs = built
    .map(({ def }) => {
      const grid = def.grid.map((row) => `      ${JSON.stringify(row)},`).join('\n')
      const source = `{ kind: 'generated', roomId: ${JSON.stringify(def.source.roomId)}, seed: ${def.source.seed}, unpushSteps: ${def.source.unpushSteps} }`
      return [
        '  {',
        `    id: ${JSON.stringify(def.id)},`,
        `    difficulty: ${JSON.stringify(def.difficulty)},`,
        '    grid: [',
        grid,
        '    ],',
        `    source: ${source},`,
        '  },',
      ].join('\n')
    })
    .join('\n')

  const witnesses = built
    .map(({ def, witness }) => `  ${JSON.stringify(def.id)}: ${JSON.stringify(witness)},`)
    .join('\n')

  return `/**
 * 关卡包（自动生成，请勿手工编辑）。
 *
 * 生成命令：npm run gen:levels
 * 来源：自绘房间模板 + 固定种子反向拉动生成（天然可解）。
 * 校验：test/levels.test.ts 用独立 A* 求解器复核每一关，并按 source 复算生成结果比对。
 */
import type { LevelDef } from './level.js'

export const LEVEL_DEFS: LevelDef[] = [
${defs}
]

/** 生成时得到的见证解法（动作方向序列）；仅用于校验，不作为游戏内提示功能 */
export const LEVEL_WITNESSES: Record<string, string[]> = {
${witnesses}
}
`
}

describe.skipIf(!ENABLED)('dump levels', () => {
  it('writes src/levels.ts', () => {
    const built = SPECS.map((spec) => buildLevel(spec, roomGrid(spec.roomId)))
    expect(built).toHaveLength(SPECS.length)
    const target = fileURLToPath(new URL('../src/levels.ts', import.meta.url))
    writeFileSync(target, renderLevelsModule(built), 'utf8')
    for (const { def, witness } of built) {
      process.stdout.write(
        `${def.id} ${def.difficulty} ${def.source.roomId} seed=${def.source.seed} pushes=${witness.length} boxes=${def.grid.join('').split('$').length - 1 + (def.grid.join('').split('*').length - 1)}\n`,
      )
    }
  })
})
