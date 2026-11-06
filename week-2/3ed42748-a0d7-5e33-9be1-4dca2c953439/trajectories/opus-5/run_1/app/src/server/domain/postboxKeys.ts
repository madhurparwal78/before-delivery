import { withTransaction, type Transaction } from '../db/pool.js';
import {
  generatedCourierName,
  newCourierId,
  newModerationRef,
  newPostboxKeyToken,
} from '../db/ids.js';
import { STARTING_SATCHEL_ID } from '../db/seed.js';
import { config } from '../config.js';
import { fail } from '../http/errors.js';
import { loadCourierIn, type CourierRow, type Role } from './couriers.js';
import { balanceIn } from './ledger.js';
import { rotateSession } from './sessions.js';
import { releaseRushParcel } from './board.js';

export interface MergeReport {
  movements: number;
  satchels_added: string[];
  parcel: 'moved' | 'dropped' | 'none';
  name_kept: 'guest' | 'courier';
}

export interface RedeemResult {
  sessionId: string;
  role: Role;
  display_name: string;
  balance: number;
  merged_guest: boolean;
  merge_report: MergeReport | null;
  return_to: string;
}

export async function createPostboxKey(email: string, returnTo: string): Promise<string> {
  const token = newPostboxKeyToken();
  await withTransaction(async (tx) => {
    await tx.query(
      'insert into postbox_keys (token, email, return_to, created_at) values ($1, $2, $3, now())',
      [token, email, returnTo],
    );
  });
  return token;
}

async function guestSaveHasProgress(tx: Transaction, courierId: string): Promise<boolean> {
  const row = await tx.one<{ progress: boolean }>(
    `select (
       exists (select 1 from movements where courier_id = $1)
       or exists (select 1 from satchels_owned where courier_id = $1 and satchel_id <> $2)
       or exists (select 1 from acceptances where courier_id = $1 and status = 'open')
     ) as progress`,
    [courierId, STARTING_SATCHEL_ID],
  );
  return row?.progress === true;
}

async function mergeGuestSave(
  tx: Transaction,
  guest: CourierRow,
  courier: CourierRow,
  courierIsNew: boolean,
): Promise<MergeReport> {
  const moved = await tx.query<{ movement_id: string }>(
    'update movements set courier_id = $2 where courier_id = $1 returning movement_id',
    [guest.courier_id, courier.courier_id],
  );
  const added = await tx.query<{ satchel_id: string }>(
    `insert into satchels_owned (courier_id, satchel_id)
     select $2, satchel_id from satchels_owned where courier_id = $1
     on conflict do nothing returning satchel_id`,
    [guest.courier_id, courier.courier_id],
  );

  const courierOpen = await tx.one<{ acceptance_id: string }>(
    `select acceptance_id from acceptances where courier_id = $1 and status = 'open' for update`,
    [courier.courier_id],
  );
  const guestOpen = await tx.one<{ acceptance_id: string; rush_id: string | null }>(
    `select acceptance_id, rush_id from acceptances
     where courier_id = $1 and status = 'open' for update`,
    [guest.courier_id],
  );
  let parcel: MergeReport['parcel'] = 'none';
  if (guestOpen !== null) {
    if (courierOpen === null) {
      await tx.query('update acceptances set courier_id = $2 where acceptance_id = $1', [
        guestOpen.acceptance_id,
        courier.courier_id,
      ]);
      parcel = 'moved';
    } else {
      await tx.query(`update acceptances set status = 'dropped' where acceptance_id = $1`, [
        guestOpen.acceptance_id,
      ]);
      if (guestOpen.rush_id !== null) await releaseRushParcel(tx, guestOpen.rush_id);
      parcel = 'dropped';
    }
  }

  await tx.query(
    `insert into tickets (courier_id, namespace, ticket, fingerprint, response, created_at)
     select $2, namespace, ticket, fingerprint, response, created_at
     from tickets where courier_id = $1
     on conflict (courier_id, namespace, ticket) do nothing`,
    [guest.courier_id, courier.courier_id],
  );
  await tx.query('delete from tickets where courier_id = $1', [guest.courier_id]);

  if (courierIsNew) {
    await tx.query(
      'update couriers set display_name = $2, worn_satchel_id = $3 where courier_id = $1',
      [courier.courier_id, guest.display_name, guest.worn_satchel_id],
    );
  }
  await tx.query('update couriers set guest_claimed = true where courier_id = $1', [
    guest.courier_id,
  ]);
  await tx.query('delete from heartbeats where courier_id = $1', [guest.courier_id]);

  return {
    movements: moved.length,
    satchels_added: added.map((row) => row.satchel_id),
    parcel,
    name_kept: courierIsNew ? 'guest' : 'courier',
  };
}

/** Redeems a single-use postbox key, merging the browser's guest save exactly once. */
export async function redeemPostboxKey(
  token: unknown,
  previous: { sessionId: string; courierId: string } | null,
  now: Date,
): Promise<RedeemResult> {
  if (typeof token !== 'string' || token.length === 0) throw fail('link_invalid');
  return withTransaction(async (tx) => {
    await tx.lock(`postbox-key:${token}`);
    const key = await tx.one<{ email: string; return_to: string; created_at: Date; used_at: Date | null }>(
      'select email, return_to, created_at, used_at from postbox_keys where token = $1 for update',
      [token],
    );
    if (key === null) throw fail('link_invalid');
    if (key.used_at !== null) throw fail('link_used');
    if (now.getTime() > key.created_at.getTime() + config.postboxKeyTtlSeconds * 1000) {
      throw fail('link_expired');
    }
    await tx.query('update postbox_keys set used_at = now() where token = $1', [token]);

    let courier = await tx.one<CourierRow>(
      `select courier_id, email, display_name, role, worn_satchel_id, name_locked, muted,
              emote, emote_at, moderation_ref, guest_claimed
       from couriers where email = $1 for update`,
      [key.email],
    );
    const courierIsNew = courier === null;
    if (courier === null) {
      const courierId = newCourierId();
      courier = await tx.one<CourierRow>(
        `insert into couriers (courier_id, email, display_name, role, worn_satchel_id, moderation_ref)
         values ($1, $2, $3, 'courier', $4, $5)
         returning courier_id, email, display_name, role, worn_satchel_id, name_locked, muted,
                   emote, emote_at, moderation_ref, guest_claimed`,
        [courierId, key.email, generatedCourierName(), STARTING_SATCHEL_ID, newModerationRef()],
      );
      await tx.query('insert into satchels_owned (courier_id, satchel_id) values ($1, $2)', [
        courierId,
        STARTING_SATCHEL_ID,
      ]);
    }

    let report: MergeReport | null = null;
    if (previous !== null && previous.courierId !== courier!.courier_id) {
      const guest = await loadCourierIn(tx, previous.courierId);
      if (
        guest !== null &&
        guest.role === 'guest' &&
        !guest.guest_claimed &&
        (await guestSaveHasProgress(tx, guest.courier_id))
      ) {
        report = await mergeGuestSave(tx, guest, courier!, courierIsNew);
      }
    }

    const sessionId = await rotateSession(tx, courier!.courier_id, previous?.sessionId ?? null);
    const fresh = await loadCourierIn(tx, courier!.courier_id);
    return {
      sessionId,
      role: fresh!.role,
      display_name: fresh!.display_name,
      balance: await balanceIn(tx, fresh!.courier_id),
      merged_guest: report !== null,
      merge_report: report,
      return_to: key.return_to,
    };
  });
}
