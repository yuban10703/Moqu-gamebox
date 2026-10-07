/** Bounds for untrusted backup/save JSON, before recursive checksumming or persistence. */
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024
export const MAX_JSON_DEPTH = 64
export const MAX_JSON_NODES = 500_000

/** Count UTF-8 bytes without allocating another copy of a potentially large file. */
export function exceedsJsonSize(text: string): boolean {
  if (text.length > MAX_BACKUP_BYTES) return true
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes++
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4
      i++
    } else bytes += 3
    if (bytes > MAX_BACKUP_BYTES) return true
  }
  return false
}

/** Iterative traversal: hostile nesting must not reach the recursive canonicalizer. */
export function isBoundedJson(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0
  let characters = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    if (++nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) return false
    const item = current.value
    if (typeof item === 'string') characters += item.length
    if (typeof item === 'number' && !Number.isFinite(item)) return false
    if (item && typeof item === 'object') {
      const entries = Object.entries(item)
      if (entries.length + nodes + stack.length > MAX_JSON_NODES) return false
      for (const [key, child] of entries) {
        if (key === '__proto__') return false
        characters += key.length
        stack.push({ value: child, depth: current.depth + 1 })
      }
    } else if (!['string', 'number', 'boolean', 'undefined'].includes(typeof item) && item !== null) {
      return false
    }
    if (characters > MAX_BACKUP_BYTES) return false
  }
  return true
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isGameId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
}
