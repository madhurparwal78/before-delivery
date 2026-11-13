import type { Profile } from '../shared/api-types'
import { formatWeight } from '../shared/display'
import { declare, optional, rules } from './fields'
import { query, type Db } from './db'
import type { Reply } from './http'

interface ProfileRow {
  display_name: string
  unit: Profile['unit']
  goal_grams: number
  time_zone: string
  paper_size: Profile['paperSize']
  passphrase_hash: string
}

export async function loadProfile(db?: Db): Promise<Profile> {
  const [row] = await query<ProfileRow>('SELECT * FROM profile WHERE id = 1', [], db)
  if (!row) throw new Error('profile is missing')
  return {
    displayName: row.display_name,
    unit: row.unit,
    goalGrams: row.goal_grams,
    goalDisplay: formatWeight(row.goal_grams, row.unit),
    timeZone: row.time_zone,
    paperSize: row.paper_size,
  }
}

export async function loadPassphraseHash(): Promise<string> {
  const [row] = await query<ProfileRow>('SELECT passphrase_hash FROM profile WHERE id = 1')
  return row?.passphrase_hash ?? ''
}

export const profileFields = declare({
  displayName: optional(rules.text(1, 60), 'Enter a display name of up to 60 characters.'),
  unit: optional(rules.unit, 'Choose a display unit.'),
  goal: optional(rules.weight(1), 'Enter a goal from 1 to 50000 g.'),
  timeZone: optional(rules.timeZone, 'Choose a time zone.'),
  paperSize: optional(rules.paper, 'Choose A4 or Letter.'),
})

export const profileReply = (profile: Profile): Reply => ({ status: 200, body: { profile } })
