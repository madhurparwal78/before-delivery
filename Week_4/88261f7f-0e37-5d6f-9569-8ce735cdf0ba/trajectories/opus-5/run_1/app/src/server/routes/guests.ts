import { pool, withTransaction } from '../db';
import { notices } from '../../shared/notices';
import { DESK_ROLES } from '../domain/roles';
import { invalid, notFoundError, validationTexts } from '../http/errors';
import { Router } from '../http/router';
import {
  applyMerge,
  listGuests,
  loadGuest,
  MergeField,
  MERGE_FIELDS,
  stayAndFolioIds,
} from '../repo/guests';
import { publishChange } from '../services/live';
import { hotelOf, textField } from './support';

function readChoices(body: Record<string, unknown>): Partial<Record<MergeField, 'merged'>> {
  const raw = body.choices;
  const choices: Partial<Record<MergeField, 'merged'>> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return choices;
  const record = raw as Record<string, unknown>;
  for (const field of MERGE_FIELDS) {
    if (record[field] === 'merged') choices[field] = 'merged';
  }
  return choices;
}

export function registerGuestRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/guests',
    access: DESK_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const search = ctx.url.searchParams.get('search') ?? '';
      return { status: 200, json: { guests: await listGuests(pool, hotel.id, search) } };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/guests/:id',
    access: DESK_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const guest = await loadGuest(pool, hotel.id, ctx.params.id);
      if (!guest) throw notFoundError();
      const ids = await stayAndFolioIds(pool, guest.id);
      return { status: 200, json: { ...guest, stayIds: ids.stayIds, folioIds: ids.folioIds } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/guests/merge',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const survivorId = textField(ctx.body, 'survivorId');
      const mergedId = textField(ctx.body, 'mergedId');
      if (survivorId !== '' && survivorId === mergedId) {
        throw invalid({ mergedId: validationTexts.differentGuests });
      }
      const survivor = await loadGuest(pool, hotel.id, survivorId);
      const merged = await loadGuest(pool, hotel.id, mergedId);
      if (!survivor || !merged) throw notFoundError();
      const result = await withTransaction(async (db) => {
        const applied = await applyMerge(db, survivor, merged, readChoices(ctx.body));
        await publishChange(db, hotel.id, {
          type: 'merge',
          notice: notices.guestsMerged(applied.staysMoved),
        });
        return applied;
      });
      return { status: 200, json: { guest: result.guest, staysMoved: result.staysMoved } };
    },
  });
}
