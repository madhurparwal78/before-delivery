/** A JSON number kept as the digits that were written, so decimals are never read through binary floating point. */
export class JsonNumber {
  constructor(readonly text: string) {}
}

const WHOLE = /^-?\d{1,15}$/

/** A whole number from a request (kept as written) or from the browser; anything else is null. */
export function wholeNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
  if (value instanceof JsonNumber && WHOLE.test(value.text)) return Number.parseInt(value.text, 10)
  return null
}

/** The decimal digits of a number from a request (as written) or typed text, or null when it is not a plain decimal. */
export function decimalText(value: unknown): string | null {
  const text = value instanceof JsonNumber ? value.text : typeof value === 'string' ? value : null
  return text !== null && /^\d+(\.\d+)?$/.test(text) ? text : null
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (value instanceof JsonNumber) return value.text
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/** A bigint known to be a safe integer, as a number. */
export function bigToInt(value: bigint): number {
  return Number.parseInt(value.toString(), 10)
}
