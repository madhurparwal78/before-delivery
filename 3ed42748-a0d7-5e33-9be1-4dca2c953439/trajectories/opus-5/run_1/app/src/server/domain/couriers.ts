import { query, queryOne, type Transaction } from '../db/pool.js';

export type Role = 'guest' | 'courier' | 'helper' | 'founder';

export interface CourierRow {
  courier_id: string;
  email: string | null;
  display_name: string;
  role: Role;
  worn_satchel_id: string;
  name_locked: boolean;
  muted: boolean;
  emote: string | null;
  emote_at: Date | null;
  moderation_ref: string;
  guest_claimed: boolean;
}

const COURIER_COLUMNS = `courier_id, email, display_name, role, worn_satchel_id, name_locked,
                         muted, emote, emote_at, moderation_ref, guest_claimed`;

export async function loadCourier(courierId: string): Promise<CourierRow | null> {
  return queryOne<CourierRow>(`select ${COURIER_COLUMNS} from couriers where courier_id = $1`, [
    courierId,
  ]);
}

export async function loadCourierIn(
  tx: Transaction,
  courierId: string,
): Promise<CourierRow | null> {
  return tx.one<CourierRow>(`select ${COURIER_COLUMNS} from couriers where courier_id = $1`, [
    courierId,
  ]);
}

export async function loadCourierByModerationRef(
  tx: Transaction,
  moderationRef: string,
): Promise<CourierRow | null> {
  return tx.one<CourierRow>(
    `select ${COURIER_COLUMNS} from couriers where moderation_ref = $1 for update`,
    [moderationRef],
  );
}

export async function satchelsOwned(courierId: string): Promise<string[]> {
  const rows = await query<{ satchel_id: string }>(
    `select s.satchel_id from satchels_owned o
     join satchels s on s.satchel_id = o.satchel_id
     where o.courier_id = $1 order by s.ordinal`,
    [courierId],
  );
  return rows.map((row) => row.satchel_id);
}

export const isStaff = (role: Role): boolean => role === 'helper' || role === 'founder';
export const isSignedIn = (role: Role): boolean => role !== 'guest';
