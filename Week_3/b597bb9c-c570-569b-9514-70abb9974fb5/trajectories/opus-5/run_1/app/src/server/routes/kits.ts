import { ApiError } from '../../domain/api-error.js';
import { codePoints, invalid } from '../../domain/validate.js';
import { query } from '../db.js';
import { jsonBody, notFound, requireOwner, requireSigned, sendJson, type Route } from '../http.js';
import { randomId } from '../ids.js';
import type { KitRecord } from '../../shared/types.js';

function readKit(body: Record<string, unknown>): Omit<KitRecord, 'id'> {
  const name = typeof body.name === 'string' ? body.name : '';
  if (codePoints(name) < 1 || codePoints(name) > 60) throw invalid('name');
  const colour = (field: string): string => {
    const value = body[field];
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{6}$/.test(value)) throw invalid(field);
    return value.toLowerCase();
  };
  const weight = body.font_weight;
  if (weight !== 400 && weight !== 600) throw invalid('font_weight');
  return { name, text_colour: colour('text_colour'), box_colour: colour('box_colour'), font_weight: weight };
}

export const kitRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/kits',
    auth: 'session',
    handle: async (context) => {
      const signed = requireSigned(context);
      if (!signed.is_owner) {
        const editable = await query<{ count: number }>(
          `select count(*)::int as count from members where person_id = $1 and role = 'editor'`,
          [signed.person.id],
        );
        if ((editable[0]?.count ?? 0) === 0) throw ApiError.of('forbidden', undefined);
      }
      const items = await query<KitRecord>(
        `select id, name, text_colour, box_colour, font_weight from kits order by created_at, id`,
      );
      sendJson(context.response, 200, { items });
    },
  },
  {
    method: 'POST',
    path: '/api/kits',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      requireOwner(context);
      const kit = readKit(jsonBody(context));
      const id = randomId('kit');
      await query(`insert into kits (id, name, text_colour, box_colour, font_weight) values ($1,$2,$3,$4,$5)`, [
        id,
        kit.name,
        kit.text_colour,
        kit.box_colour,
        kit.font_weight,
      ]);
      sendJson(context.response, 201, { id, ...kit });
    },
  },
  {
    method: 'PUT',
    path: '/api/kits/{id}',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      requireOwner(context);
      const kit = readKit(jsonBody(context));
      const updated = await query<{ id: string }>(
        `update kits set name = $2, text_colour = $3, box_colour = $4, font_weight = $5 where id = $1 returning id`,
        [context.params.id, kit.name, kit.text_colour, kit.box_colour, kit.font_weight],
      );
      if (updated.length === 0) throw notFound();
      sendJson(context.response, 200, { id: context.params.id, ...kit });
    },
  },
];
