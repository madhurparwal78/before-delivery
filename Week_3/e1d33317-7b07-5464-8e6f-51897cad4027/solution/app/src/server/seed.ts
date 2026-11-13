// The seed score "Tidewater Nocturne", inserted at start when missing.

import type pg from 'pg'
import { Voice, voiceToJson, type NewEvent, type VoiceElement } from '../shared/voice.js'
import type { Pitch } from '../shared/music.js'

const STAVES = [
  ['st-fl', 'Flute', 'treble', 0, 0, 'p-fl', 'Flute'],
  ['st-ob', 'Oboe', 'treble', 0, 0, 'p-ob', 'Oboe'],
  ['st-cl', 'Clarinet in B♭', 'treble', -1, -2, 'p-cl', 'Clarinet in B♭'],
  ['st-bn', 'Bassoon', 'bass', 0, 0, 'p-bn', 'Bassoon'],
  ['st-hn', 'Horn in F', 'treble', -4, -7, 'p-hn', 'Horn in F'],
  ['st-tp', 'Trumpet in B♭', 'treble', -1, -2, 'p-tp', 'Trumpet in B♭'],
  ['st-timp', 'Timpani', 'bass', 0, 0, 'p-timp', 'Timpani'],
  ['st-hp-r', 'Harp (right hand)', 'treble', 0, 0, 'p-hp', 'Harp'],
  ['st-hp-l', 'Harp (left hand)', 'bass', 0, 0, 'p-hp', 'Harp'],
  ['st-vn1', 'Violin I', 'treble', 0, 0, 'p-vn1', 'Violin I'],
  ['st-vn2', 'Violin II', 'treble', 0, 0, 'p-vn2', 'Violin II'],
  ['st-va', 'Viola', 'alto', 0, 0, 'p-va', 'Viola'],
  ['st-vc', 'Cello', 'bass', 0, 0, 'p-vc', 'Cello'],
  ['st-db', 'Double Bass', 'bass', -7, -12, 'p-db', 'Double Bass'],
] as const

const COLLABORATORS = [
  ['c-mara', 'Mara Lindqvist', 'composer', 'active', [], 'seat-composer-7f3a', null],
  ['c-jun', 'Jun Okafor', 'copyist', 'active', [], 'seat-copyist-2c9e', null],
  ['c-ines', 'Inès Varga', 'player', 'active', ['st-ob'], 'seat-oboe-5b1d', null],
  ['c-theo', 'Theo Brandt', 'player', 'active', ['st-vn1'], 'seat-violin1-8e4f', null],
  ['c-ruth', 'Ruth Abara', 'player', 'invited', ['st-va'], null, 'inv-viola-3a6c'],
] as const

const note = (step: Pitch['step'], octave: number, duration: NewEvent['duration'], dots = 0, alter = 0): NewEvent => ({
  kind: 'note', pitch: { step, alter, octave }, duration, dots,
})
const rest = (duration: NewEvent['duration']): NewEvent => ({ kind: 'rest', duration, dots: 0 })

/** Seed music, voice 1, site `seed`, listed by lamport (staff, event, extra fields). */
const MUSIC: [number, string, NewEvent, Partial<Pick<VoiceElement, 'tie' | 'dynamic' | 'text'>>?][] = [
  [1, 'st-ob', rest('whole')],
  [2, 'st-ob', rest('whole')],
  [3, 'st-ob', note('E', 5, 'quarter'), { dynamic: 'p', text: '<i>dolce</i>' }],
  [4, 'st-ob', note('F', 5, 'quarter', 0, 1)],
  [5, 'st-ob', note('G', 5, 'half')],
  [6, 'st-ob', note('A', 5, 'half', 1)],
  [7, 'st-ob', note('B', 5, 'quarter'), { tie: true }],
  [8, 'st-ob', note('B', 5, 'whole')],
  [9, 'st-vn1', note('G', 4, 'whole')],
  [10, 'st-vn1', note('A', 4, 'whole')],
  [11, 'st-vn1', note('B', 4, 'half')],
  [12, 'st-vn1', note('D', 5, 'half')],
  [13, 'st-cl', note('C', 5, 'whole')],
]

function seedVoices(): Record<string, VoiceElement[]> {
  const voices = new Map<string, Voice>()
  const last = new Map<string, VoiceElement | undefined>()
  for (const [lamport, staffId, event, extra] of MUSIC) {
    const voice = voices.get(staffId) ?? new Voice()
    voices.set(staffId, voice)
    const after = last.get(staffId)?.id ?? null
    voice.apply({ id: { lamport, site: 'seed' }, type: 'insert', staffId, voice: 1, after, event })
    const element = voice.elements[voice.elements.length - 1] as VoiceElement
    Object.assign(element, extra)
    last.set(staffId, element)
  }
  return Object.fromEntries([...voices].map(([staffId, voice]) => [`${staffId}:1`, voiceToJson(voice)]))
}

export async function seedScore(client: pg.PoolClient): Promise<void> {
  try {
    await insertSeed(client)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function insertSeed(client: pg.PoolClient): Promise<void> {
  await client.query('BEGIN')
  const inserted = await client.query(
    `INSERT INTO scores (id, title, measure_count, time_signatures, tempos, lamport, last_seq)
     VALUES ('sc-tidewater', 'Tidewater Nocturne', 48, $1, $2, 13, 0) ON CONFLICT DO NOTHING`,
    [
      JSON.stringify([{ measure: 1, beats: 4, beatType: 4 }, { measure: 25, beats: 3, beatType: 4 }]),
      JSON.stringify([{ measure: 1, bpm: 72 }, { measure: 25, bpm: 96 }]),
    ],
  )
  if (inserted.rowCount) {
    for (const [order, [id, name, clef, diatonic, chromatic, partId]] of STAVES.entries()) {
      await client.query('INSERT INTO staves (id, score_id, name, clef, transpose, part_id, ord) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        id, 'sc-tidewater', name, clef, JSON.stringify({ diatonic, chromatic }), partId, order,
      ])
    }
    const parts = new Map(STAVES.map((s) => [s[5], s[6]]))
    for (const [id, name] of parts) {
      await client.query('INSERT INTO parts (id, score_id, name) VALUES ($1, $2, $3)', [id, 'sc-tidewater', name])
    }
    for (const [id, name, role, status, staffIds, seat, invite] of COLLABORATORS) {
      await client.query(
        'INSERT INTO collaborators (id, score_id, name, role, status, staff_ids, seat_token, invite_token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [id, 'sc-tidewater', name, role, status, JSON.stringify(staffIds), seat, invite],
      )
    }
    await client.query('INSERT INTO snapshots (score_id, seq, state) VALUES ($1, 0, $2)', ['sc-tidewater', JSON.stringify({ voices: seedVoices() })])
  }
  await client.query('COMMIT')
}
