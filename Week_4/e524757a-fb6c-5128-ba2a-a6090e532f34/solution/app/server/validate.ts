/** Request-boundary checks: after these, values are trusted. */
import { HEADINGS, ISLANDS, type Heading, type Tile } from '../shared/island'

export const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)
export const isHeading = (value: unknown): value is Heading => typeof value === 'string' && (HEADINGS as readonly string[]).includes(value)
export const isIslandId = (value: unknown): value is number => isInteger(value) && ISLANDS.some((island) => island.id === value)
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isText = (value: unknown): value is string => typeof value === 'string'

export function readTile(value: unknown): Tile | null {
  return Array.isArray(value) && value.length === 2 && isInteger(value[0]) && isInteger(value[1]) ? [value[0], value[1]] : null
}

/** Characters, not UTF-16 units. */
export const lengthOf = (text: string): number => Array.from(text).length
export const isBlank = (text: string): boolean => text.trim() === ''

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>).sort(([p], [q]) => (p < q ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
