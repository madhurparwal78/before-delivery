import type { PoolClient } from 'pg';
import type { OpeningCalendar } from '../domain/calendar';
import { today } from '../../shared/time';
import { membershipView, readMembershipRow } from '../repo/users';
import { setHoldStatus } from '../repo/inventory';
import { holdReadyMail, queueMail } from '../services/mail';

/**
 * Promotes the tool's first queued hold whose member is active, exactly once per
 * triggering event, and queues its one hold-ready email in the same transaction.
 */
export async function promoteHoldForItem(
  client: PoolClient,
  itemId: number,
  calendar: OpeningCalendar,
  now: Date,
): Promise<void> {
  const queued = await client.query<{ id: number; member_id: number }>(
    `select h.id, h.member_id from holds h where h.item_id = $1 and h.status = 'queued'
     order by h.placed_at, h.id for update`,
    [itemId],
  );
  const libraryToday = today(calendar.timeZone, now);
  for (const hold of queued.rows) {
    const membership = await readMembershipRow(client, hold.member_id);
    if (!membership || membershipView(membership, libraryToday).status !== 'active') continue;
    await setHoldStatus(client, hold.id, 'ready');
    const item = await client.query<{ tag: string; name: string }>(
      'select tag, name from items where id = $1',
      [itemId],
    );
    const member = await client.query<{ email: string }>('select email from users where id = $1', [
      hold.member_id,
    ]);
    const tool = item.rows[0];
    const email = member.rows[0]?.email;
    if (tool && email) {
      const nextOpenDay = calendar.nextOpenDayOnOrAfter(libraryToday);
      const message = holdReadyMail(tool.name, tool.tag, libraryToday, calendar, nextOpenDay);
      await queueMail(client, `hold-ready:${hold.id}`, email, message.subject, message.body);
    }
    return;
  }
}
