import { createHash, randomBytes } from 'node:crypto'

// Canonical JSON: keys sorted at every depth, no whitespace, non-ASCII left unescaped.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).filter(key => record[key] !== undefined).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function sha256Hex(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex')
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString('hex')}`
}
