import { fail, validation } from './errors'

export interface CardFields { card_number?: unknown; expiry?: unknown; security_code?: unknown; step_up_code?: unknown }

const APPROVED = '9000000000000002'
const DECLINED = '9000000000000010'
const EXPIRED = '9000000000000028'
const STEP_UP = '9000000000000036'
const STEP_UP_CODE = '1234'

export function cardFieldErrors(body: CardFields): Record<string, string> {
  const fields: Record<string, string> = {}
  if (typeof body.card_number !== 'string' || body.card_number === '') fields.card_number = 'required'
  else if (!/^\d{16}$/.test(body.card_number.replace(/ /g, ''))) fields.card_number = 'invalid'
  if (typeof body.expiry !== 'string' || body.expiry === '') fields.expiry = 'required'
  else if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(body.expiry)) fields.expiry = 'invalid'
  if (typeof body.security_code !== 'string' || body.security_code === '') fields.security_code = 'required'
  else if (!/^\d{3}$/.test(body.security_code)) fields.security_code = 'invalid'
  return fields
}

export function nameErrors(body: { given_name?: unknown; surname?: unknown }): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const key of ['given_name', 'surname'] as const) {
    const value = body[key]
    if (typeof value !== 'string' || value.trim() === '') fields[key] = 'required'
    else if (value.length > 80) fields[key] = 'too_long'
  }
  return fields
}

export function requireValid(fields: Record<string, string>): void {
  if (Object.keys(fields).length) validation(fields)
}

/** The card table: a refusal is a 402 with the outcome; an approved card returns its last four digits. */
export function charge(body: CardFields): string {
  const number = String(body.card_number).replace(/ /g, '')
  if (number === APPROVED) return number.slice(-4)
  if (number === DECLINED) return fail(402, 'card', { outcome: 'declined' })
  if (number === EXPIRED) return fail(402, 'card', { outcome: 'expired' })
  if (number === STEP_UP) {
    if (body.step_up_code === undefined || body.step_up_code === null || body.step_up_code === '') return fail(402, 'card', { outcome: 'step_up' })
    if (body.step_up_code !== STEP_UP_CODE) return fail(402, 'card', { outcome: 'wrong_code' })
    return number.slice(-4)
  }
  return fail(402, 'card', { outcome: 'unknown' })
}
