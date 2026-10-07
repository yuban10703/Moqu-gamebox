import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup } from '../src/backup.js'
import { createBaseline } from '../src/diagnostics.js'
import { canonicalJson, checksumOf, newEnvelope, parseEnvelope, reseal } from '../src/save.js'
import { DEFAULT_SETTINGS, effectiveSettings, parseSettings } from '../src/settings.js'
import { MAX_BACKUP_BYTES, MAX_JSON_NODES, exceedsJsonSize } from '../src/inputLimits.js'

const env = () => newEnvelope({ gameId: 'sokoban', rulesVersion: 1, contentVersion: 1,
  difficulty: 'starter', seed: 7, state: { levelId: 'L01', log: [] } }, 1700000000000)

describe('untrusted backup input', () => {
  it('rejects deeply nested JSON without overflowing the checksum stack', () => {
    const text = '{"schema":1,"checksum":"x","saves":[],"extra":' +
      '['.repeat(12000) + '0' + ']'.repeat(12000) + '}'
    expect(() => parseBackup(text)).not.toThrow()
    expect(parseBackup(text).ok).toBe(false)
  })

  it('does not omit __proto__ from the checksummed data', () => {
    const value = JSON.parse('{"__proto__":{"completed":[]},"safe":1}')
    expect(canonicalJson(value)).toBe('{"__proto__":{"completed":[]},"safe":1}')
  })

  it.each([{ completed: {} }, { completed: 7 }, { completed: [null] }, { completed: ['L01', {}] }])(
    'rejects a checksummed save with invalid completed progress: %j', ({ completed }) => {
    expect(parseEnvelope(reseal({ ...env(), progress: { completed } })).ok).toBe(false)
  })

  it('enforces byte and node budgets before checksumming', () => {
    expect(parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).toEqual({ ok: false, errors: ['backup-too-large'] })
    expect(exceedsJsonSize('墨'.repeat(Math.floor(MAX_BACKUP_BYTES / 3) + 1))).toBe(true)
    expect(parseBackup(JSON.stringify({ schema: 1, saves: [], checksum: 'x',
      extra: Array(MAX_JSON_NODES + 1).fill(0) })).ok).toBe(false)
  })

  it('rejects duplicate game IDs instead of repeatedly overwriting the same slot', () => {
    const backup = createBackup({ device: createBaseline({ platform: 'web', recordedAt: 1 }),
      saves: [env(), env()], records: [], settings: DEFAULT_SETTINGS, exportedAt: 1 })
    expect(parseBackup(JSON.stringify(backup))).toEqual({ ok: false, errors: ['duplicate-game-id'] })
  })

  it('rejects malformed completion records before they can persist', () => {
    const backup = createBackup({ device: createBaseline({ platform: 'web', recordedAt: 1 }),
      saves: [env()], records: [], settings: DEFAULT_SETTINGS, exportedAt: 1 })
    const { checksum: _, ...body } = backup
    const malicious = { ...body, records: [null, null] }
    expect(parseBackup(JSON.stringify({ ...malicious, checksum: checksumOf(malicious) })).ok).toBe(false)
  })

  it('normalizes per-game settings instead of exposing arbitrary imported values to rendering', () => {
    const settings = parseSettings({ perGame: { sokoban: { difficulty: {}, timer: 'yes' },
      sudoku: { difficulty: 'skilled', dpad: false }, broken: null } })
    expect(effectiveSettings(settings, 'sokoban').difficulty).toBeUndefined()
    expect(effectiveSettings(settings, 'sokoban').timer).toBe(true)
    expect(effectiveSettings(settings, 'sudoku').difficulty).toBe('skilled')
    expect(effectiveSettings(settings, 'sudoku').dpad).toBe(false)
  })
})
