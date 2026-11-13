// Sample banks: the name, size and content checks of Server boundary are decided here, once.

import { randomBytes } from 'node:crypto'
import { parseRoot } from '../shared/music.js'
import type { Bank } from '../shared/protocol.js'
import { query } from './db.js'
import { ApiError, validation } from './errors.js'
import { broadcast } from './hub.js'
import type { ScoreState } from './state.js'
import { getObject, putObject } from './storage.js'

const NAME = /^[A-Za-z0-9 ._()-]{1,120}$/
const SFZ_HEADERS = new Set(['<control>', '<global>', '<master>', '<group>', '<region>', '<curve>', '<effect>', '<midi>'])
const unsupportedType = () => new ApiError(415, 'unsupported_type', 'Upload a WAV (RIFF/WAVE) or SFZ file.')

interface BankRow {
  id: string
  file_name: string
  kind: 'wav' | 'sfz'
  bytes: number
  staff_id: string
  root_pitch: string | null
  created_at: Date
}

const toBank = (r: BankRow): Bank => ({
  id: r.id, fileName: r.file_name, kind: r.kind, bytes: r.bytes, staffId: r.staff_id, rootPitch: r.root_pitch, status: 'loaded', createdAt: r.created_at.toISOString(),
})

function isWav(data: Buffer): boolean {
  return data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WAVE'
}

function isSfz(data: Buffer): boolean {
  if (data.includes(0)) return false
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return false
  }
  const first = /^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(<[a-z]+>)/.exec(text)
  return !!first && SFZ_HEADERS.has(first[1] as string)
}

export async function addBank(state: ScoreState, params: URLSearchParams, data: Buffer): Promise<Bank> {
  const fileName = params.get('fileName') ?? ''
  const errors: Record<string, string> = {}
  const extension = /\.(wav|sfz)$/i.exec(fileName)?.[1]?.toLowerCase()
  if (!NAME.test(fileName) || fileName.includes('..') || !extension) errors.fileName = 'Use a plain file name ending in .wav or .sfz.'
  const staffId = params.get('staffId') ?? ''
  if (!state.staff(staffId)) errors.staffId = 'Choose a staff.'
  const root = params.get('root')
  if (extension === 'wav' && root !== null && !parseRoot(root)) errors.root = 'Use a pitch like A4, C#5 or Bb3.'
  if (Object.keys(errors).length) throw validation(errors)
  const kind = extension as 'wav' | 'sfz'
  if (kind === 'wav' ? !isWav(data) : !isSfz(data)) throw unsupportedType()
  const id = `bk-${randomBytes(6).toString('hex')}`
  await putObject(`scores/${state.id}/banks/${id}/${fileName}`, data, kind === 'wav' ? 'audio/wav' : 'text/plain; charset=utf-8')
  const [row] = await query<BankRow>(
    `INSERT INTO banks (id, score_id, staff_id, file_name, kind, bytes, root_pitch) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, file_name, kind, bytes, staff_id, root_pitch, created_at`,
    [id, state.id, staffId, fileName, kind, data.length, kind === 'wav' ? (root ?? 'A4') : null])
  const bank = toBank(row as BankRow)
  broadcast(state.id, { type: 'bank', bank })
  return bank
}

export async function listBanks(state: ScoreState): Promise<Bank[]> {
  const rows = await query<BankRow>(
    'SELECT id, file_name, kind, bytes, staff_id, root_pitch, created_at FROM banks WHERE score_id = $1 ORDER BY created_at DESC, id DESC', [state.id])
  return rows.map(toBank)
}

export async function bankContent(state: ScoreState, bankId: string): Promise<{ bank: Bank; data: Uint8Array } | null> {
  const bank = (await listBanks(state)).find((b) => b.id === bankId)
  if (!bank) return null
  const data = await getObject(`scores/${state.id}/banks/${bank.id}/${bank.fileName}`)
  return data ? { bank, data } : null
}
