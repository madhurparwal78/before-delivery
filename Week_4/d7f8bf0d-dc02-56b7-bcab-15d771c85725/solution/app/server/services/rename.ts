import type { Tx } from '../db'
import { supersedeReady } from './packets'
import { sessionsOfLayout, saveSession } from './session-store'
import type { LayoutRow } from './layout-store'

// A rename updates every non-Ended session of the layout in the same commit, with a name.changed event on each
// stream, and leaves the stored PDFs unchanged while marking them Superseded.
export async function renameInSessions(tx: Tx, layout: LayoutRow, kind: 'block' | 'station', id: string, name: string): Promise<void> {
  for (const session of await sessionsOfLayout(tx.client, layout.id)) {
    const target = kind === 'block' ? session.state.blocks.find(block => block.id === id) : session.state.stations.find(station => station.id === id)
    if (target === undefined) continue
    const from = target.name
    target.name = name
    const superseded = await supersedeReady(tx.client, session.id)
    await saveSession(tx, session, { type: 'name.changed', detail: { kind, id, from, to: name, superseded_packet_ids: superseded } })
  }
}
