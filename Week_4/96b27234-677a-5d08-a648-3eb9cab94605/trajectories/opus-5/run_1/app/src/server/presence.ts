import { query } from './db.js';
import type { PersonRow } from './auth.js';
import { getAsset } from './assets.js';
import { getOpenSession, maySeeSessionRow } from './sessions.js';
import { onlineIds } from './services/valkey.js';

export interface PresenceView {
  presence: 'online' | 'in-session' | 'offline';
  session: { id: string; roomName: string } | null;
}

export async function presenceFor(viewer: PersonRow, personIds: string[]): Promise<Map<string, PresenceView>> {
  const views = new Map<string, PresenceView>();
  if (personIds.length === 0) return views;
  const online = await onlineIds(personIds);
  const memberships = await query<{ person_id: string; session_id: string }>(
    `select m.person_id, m.session_id from session_members m
       join sessions s on s.id = m.session_id
      where m.active = true and s.status = 'open' and m.person_id = any($1)`,
    [personIds]
  );
  for (const personId of personIds) {
    const membership = memberships.find((row) => row.person_id === personId);
    if (membership !== undefined) {
      const session = await getOpenSession(membership.session_id);
      if (session !== null && (await maySeeSessionRow(viewer, session))) {
        const room = await getAsset(session.room_asset_id);
        views.set(personId, { presence: 'in-session', session: { id: session.id, roomName: room?.name ?? '' } });
        continue;
      }
      views.set(personId, { presence: 'online', session: null });
      continue;
    }
    views.set(personId, { presence: online.has(personId) ? 'online' : 'offline', session: null });
  }
  return views;
}
