/**
 * 关卡包：把 levels.ts 里的关卡定义解析成可用的 ParsedLevel，并提供难度/顺序查询。
 * 解析在模块加载时完成一次；任何格式错误都会立刻抛错（构建期就能发现，而不是留给玩家）。
 */
import { parseLevel, type DifficultyId, type LevelDef, type ParsedLevel } from './level.js'
import { LEVEL_DEFS } from './levels.js'

export interface SokobanLevel {
  def: LevelDef
  parsed: ParsedLevel
  /** 在整包中的序号（从 1 开始），用于界面显示 */
  index: number
}

export const PACK: readonly SokobanLevel[] = LEVEL_DEFS.map((def, i) => ({
  def,
  parsed: parseLevel(def),
  index: i + 1,
}))

const BY_ID = new Map(PACK.map((level) => [level.def.id, level]))

export function levelById(id: string): SokobanLevel | undefined {
  return BY_ID.get(id)
}

export function levelsFor(difficulty: DifficultyId): readonly SokobanLevel[] {
  return PACK.filter((level) => level.def.difficulty === difficulty)
}

export function firstLevelId(difficulty: DifficultyId): string {
  const list = levelsFor(difficulty)
  if (list.length === 0) throw new Error(`no levels for difficulty ${difficulty}`)
  return list[0]!.def.id
}

/** 下一关按整包顺序推进（跨难度时自然进入更高难度） */
export function nextLevelId(id: string): string | null {
  const current = BY_ID.get(id)
  if (!current) return null
  const next = PACK[current.index] // index 是从 1 开始的序号，正好指向下一项
  return next ? next.def.id : null
}

export function isLastLevel(id: string): boolean {
  return nextLevelId(id) === null
}

export function packProgress(completed: readonly string[]): { done: number; total: number } {
  const done = PACK.filter((level) => completed.includes(level.def.id)).length
  return { done, total: PACK.length }
}
