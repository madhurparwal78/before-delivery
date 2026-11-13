import { withTransaction } from '../db/pool';
import { env } from '../env';
import { addHistory } from '../repo/pieces';
import { queueMessage } from '../repo/outbox';
import { pickupReminder } from '../services/messages';

const REMINDER_DAYS = 14;
const LAPSE_DAYS = 21;

interface WaitingRow {
  number: string;
  pickup_shelf: string | null;
  owner_kind: 'member' | 'guest';
  guest_email: string | null;
  member_email: string | null;
}

/**
 * Sends the one pickup reminder a ready piece gets, and lapses the ones left
 * too long. The row guards make each happen exactly once, whichever instance
 * gets there first.
 */
export async function tickPickupClock(now: Date): Promise<void> {
  const reminderCutoff = new Date(now.getTime() - REMINDER_DAYS * env.pickupDaySeconds * 1000);
  const lapseCutoff = new Date(now.getTime() - LAPSE_DAYS * env.pickupDaySeconds * 1000);

  await withTransaction(async (client) => {
    const due = await client.query<WaitingRow>(
      `update pieces p set reminder_sent_at = $2
       from (
         select number from pieces
         where status = 'ready' and reminder_sent_at is null and ready_at <= $1
         for update skip locked
       ) picked
       where p.number = picked.number
       returning p.number, p.pickup_shelf, p.owner_kind, p.guest_email,
                 (select email from users u where u.id = p.owner_user_id) as member_email`,
      [reminderCutoff, now],
    );
    for (const piece of due.rows) {
      const to = piece.owner_kind === 'member' ? piece.member_email : piece.guest_email;
      if (!to) continue;
      await queueMessage(
        client,
        pickupReminder({
          to,
          pieceNumber: piece.number,
          pickupShelf: piece.pickup_shelf ?? '',
          daysWaiting: REMINDER_DAYS,
        }),
      );
    }
  });

  await withTransaction(async (client) => {
    const lapsed = await client.query<{ number: string }>(
      `update pieces p set status = 'uncollected'
       from (
         select number from pieces where status = 'ready' and ready_at <= $1
         for update skip locked
       ) picked
       where p.number = picked.number
       returning p.number`,
      [lapseCutoff],
    );
    for (const piece of lapsed.rows) {
      await addHistory(client, piece.number, 'Shelfmark', 'uncollected');
    }
  });
}
