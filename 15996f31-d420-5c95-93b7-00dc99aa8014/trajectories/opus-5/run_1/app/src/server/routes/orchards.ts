import type { OrchardBlockSummary, OrchardListItem } from '../../shared/api-types';
import type { OrderStatus } from '../../shared/labels';
import { dateText, int, one, query, rows, text, withTransaction } from '../db';
import { recordAudit } from '../data/outbox';
import { findGrower } from '../data/users';
import { visibleOrderIds } from '../data/visibility';
import { newId } from '../domain/ids';
import { requireRole, type Route } from '../http/router';
import {
  FieldErrors,
  asArray,
  asRecord,
  lengthWithin,
  scaledDecimal,
  trimmedString,
} from '../http/validate';
import { pool } from '../db';

const MAX_BLOCKS = 12;

interface BlockInput {
  name: string;
  acresTenths: number;
}

async function listOrchards(actorId: string, role: string): Promise<OrchardListItem[]> {
  const orchardRows =
    role === 'grower'
      ? await query(
          `select o.id, o.name, o.county, o.grower_id, u.business_name as grower_name
             from orchards o join users u on u.id = o.grower_id
            where o.grower_id = $1 order by o.position, o.name`,
          [actorId],
        )
      : await query(
          `select o.id, o.name, o.county, o.grower_id, u.business_name as grower_name
             from orchards o join users u on u.id = o.grower_id order by o.position, o.name`,
        );

  const blockRows = await query(
    'select id, orchard_id, name, acres_tenths from blocks order by position, name',
  );
  const orderRows = await query(
    'select id, orchard_id, ref, status, bloom_start from orders order by bloom_start, ref',
  );
  return orchardRows.map((row) => {
    const orchardId = text(row.id);
    const item: OrchardListItem = {
      id: orchardId,
      name: text(row.name),
      county: text(row.county),
      blocks: blockRows
        .filter((block) => text(block.orchard_id) === orchardId)
        .map((block) => ({
          id: text(block.id),
          name: text(block.name),
          acres: int(block.acres_tenths) / 10,
        })),
      orders: orderRows
        .filter((order) => text(order.orchard_id) === orchardId)
        .map((order) => ({
          id: text(order.id),
          ref: text(order.ref),
          status: text(order.status) as OrderStatus,
          bloom_start: dateText(order.bloom_start),
        })),
    };
    if (role === 'broker') {
      item.grower = { id: text(row.grower_id), name: text(row.grower_name) };
    }
    return item;
  });
}

export const orchardRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/orchards',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker', 'grower', 'beekeeper');
      const visible = new Set(await visibleOrderIds(pool, actor));
      const all = await listOrchards(actor.id, actor.role);
      const filtered = all
        .map((orchard) => ({
          ...orchard,
          orders: orchard.orders.filter((order) => visible.has(order.id)),
        }))
        .filter((orchard) => actor.role !== 'beekeeper' || orchard.orders.length > 0);
      return { status: 200, json: filtered };
    },
  },
  {
    method: 'POST',
    path: '/api/orchards',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker');
      const fields = new FieldErrors();
      const growerId = trimmedString(ctx.body.json.grower_id);
      const name = trimmedString(ctx.body.json.name);
      const county = trimmedString(ctx.body.json.county);
      const rawBlocks = asArray(ctx.body.json.blocks);

      const grower = growerId === null ? null : await findGrower(pool, growerId);
      if (grower === null) fields.add('grower_id', 'Choose a grower');
      if (!lengthWithin(name, 1, 80)) fields.add('name', 'Orchard name must be 1 to 80 characters');
      if (!lengthWithin(county, 1, 40)) fields.add('county', 'County must be 1 to 40 characters');
      if (rawBlocks.length < 1 || rawBlocks.length > MAX_BLOCKS) {
        fields.add('blocks', 'An orchard needs 1 to 12 blocks');
      }

      const blocks: BlockInput[] = [];
      const seen = new Set<string>();
      rawBlocks.forEach((entry, index) => {
        const record = asRecord(entry);
        const blockName = trimmedString(record.name);
        const acresTenths = scaledDecimal(record.acres, 1);
        if (!lengthWithin(blockName, 1, 30) || seen.has((blockName ?? '').toLowerCase())) {
          fields.add(
            `blocks.${index}.name`,
            'Block names must be 1 to 30 characters and unique in the orchard',
          );
        } else {
          seen.add((blockName as string).toLowerCase());
        }
        if (acresTenths === null || acresTenths < 10 || acresTenths > 5000) {
          fields.add(
            `blocks.${index}.acres`,
            'Acres must be between 1 and 500 with at most one decimal',
          );
        }
        if (blockName !== null && acresTenths !== null) {
          blocks.push({ name: blockName, acresTenths });
        }
      });
      fields.throwIfAny();

      const orchardId = newId('orc');
      const created = await withTransaction(async (client) => {
        const position = await one(
          client,
          'select coalesce(max(position), -1) + 1 as next from orchards',
        );
        await client.query(
          'insert into orchards (id, grower_id, name, county, position) values ($1,$2,$3,$4,$5)',
          [orchardId, growerId, name, county, int(position?.next ?? 0)],
        );
        const createdBlocks: OrchardBlockSummary[] = [];
        for (const [index, block] of blocks.entries()) {
          const blockId = newId('blk');
          await client.query(
            'insert into blocks (id, orchard_id, name, acres_tenths, position) values ($1,$2,$3,$4,$5)',
            [blockId, orchardId, block.name, block.acresTenths, index],
          );
          createdBlocks.push({ id: blockId, name: block.name, acres: block.acresTenths / 10 });
        }
        await recordAudit(client, {
          entityType: 'orchard',
          entityId: orchardId,
          action: 'created',
          actorId: actor.id,
          detail: { name, county },
        });
        return createdBlocks;
      });

      return {
        status: 201,
        json: {
          id: orchardId,
          name: name as string,
          county: county as string,
          blocks: created,
          orders: [],
          grower: { id: grower?.id as string, name: grower?.businessName as string },
        },
      };
    },
  },
];

export async function orchardBlocks(
  orchardId: string,
): Promise<Array<{ id: string; name: string }>> {
  const blockRows = await rows(
    pool,
    'select id, name from blocks where orchard_id = $1 order by position, name',
    [orchardId],
  );
  return blockRows.map((row) => ({ id: text(row.id), name: text(row.name) }));
}
