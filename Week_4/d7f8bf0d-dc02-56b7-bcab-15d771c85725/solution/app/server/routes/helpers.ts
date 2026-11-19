import type { Tx } from '../db'
import type { Ctx, Reply } from '../http/pipeline'
import { invalidFields } from '../http/errors'

export const json = (status: number, body: unknown): Reply => ({ status, body })

export function textField(body: Record<string, unknown>, name: string, label: string, max = 80): string {
  const value = body[name]
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > max) {
    throw invalidFields({ [name]: `Enter ${label} of up to ${max} characters.` })
  }
  return value.trim()
}

export const actorOf = (c: Ctx): { id: string; display_name: string } => ({ id: c.user.id, display_name: c.user.display_name })

// Writes run inside one transaction; the pipeline guarantees it for every write route.
export const txOf = (c: Ctx): Tx => c.tx as Tx
