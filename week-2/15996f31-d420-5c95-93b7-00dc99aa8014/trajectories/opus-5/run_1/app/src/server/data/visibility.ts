import { rows, text, type Queryable } from '../db';
import type { Actor } from '../http/router';

/** The orders a caller may read, by the published visibility rules. */
export async function visibleOrderIds(client: Queryable, actor: Actor): Promise<string[]> {
  if (actor.role === 'broker') {
    const all = await rows(client, 'select id from orders');
    return all.map((row) => text(row.id));
  }
  if (actor.role === 'grower') {
    const own = await rows(
      client,
      `select o.id from orders o join orchards orc on orc.id = o.orchard_id
        where orc.grower_id = $1 and o.status <> 'draft'`,
      [actor.id],
    );
    return own.map((row) => text(row.id));
  }
  const forBeekeeper = await rows(
    client,
    `select id from orders where status = 'open'
      union
     select order_id as id from drops where beekeeper_id = $1`,
    [actor.id],
  );
  return forBeekeeper.map((row) => text(row.id));
}

export async function canSeeOrder(
  client: Queryable,
  actor: Actor,
  orderId: string,
): Promise<boolean> {
  const ids = await visibleOrderIds(client, actor);
  return ids.includes(orderId);
}
