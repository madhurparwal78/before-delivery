import { pool, withTransaction } from '../db';
import { notices } from '../../shared/notices';
import { OWNER_ONLY } from '../domain/roles';
import { errorTexts, failure, invalid, validationTexts } from '../http/errors';
import { Router } from '../http/router';
import { currentNight } from '../repo/hotels';
import { blockersFor, isClosed, runClose } from '../repo/close';
import { publishChange } from '../services/live';
import { dateField, hotelOf } from './support';

export function registerCloseRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/close',
    access: OWNER_ONLY,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const businessDate = dateField(ctx.body, 'businessDate');
      if (businessDate === null) {
        throw invalid({ businessDate: validationTexts.dateRange });
      }
      if (businessDate < hotel.businessDate || (await isClosed(pool, hotel.id, businessDate))) {
        throw failure(409, errorTexts.alreadyClosed);
      }
      if (businessDate > hotel.businessDate || currentNight(hotel) <= hotel.businessDate) {
        throw failure(409, errorTexts.closeNotOpen);
      }
      const blockers = await blockersFor(pool, hotel.id, businessDate);
      if (blockers.length > 0) {
        throw failure(409, blockers[0].text, { blockers });
      }
      const result = await withTransaction(async (db) => {
        const closed = await runClose(db, hotel, businessDate);
        await publishChange(db, hotel.id, {
          type: 'close',
          notice: notices.closeDone(closed.businessDate, closed.roomsCharged, closed.noShows),
          businessDate: closed.newBusinessDate,
        });
        return closed;
      });
      return { status: 200, json: result };
    },
  });
}
