import { pool, rows } from '../db';
import { notices } from '../../shared/notices';
import { DESK_ROLES, BOARD_ROLES } from '../domain/roles';
import { invalid, validationTexts } from '../http/errors';
import { Router } from '../http/router';
import { freeRoomCount, listRooms } from '../repo/hotels';
import { lastClose, stampsFor } from '../repo/close';
import { MAX_TIMELINE_NIGHTS, nightsOfRange, rangeNightCount } from '../repo/reports';
import { subscribe } from '../services/live';
import { hotelOf, queryDate, signedInUser } from './support';

interface BlockRow {
  stay_id: string;
  room_id: string;
  first_night: string;
  nights: number;
  status: string;
  guest_name: string;
  checked_in_online: boolean;
  version: number;
}

export function registerDeskRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/desk',
    access: DESK_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const free = await freeRoomCount(pool, hotel.id, hotel.businessDate);
      return {
        status: 200,
        json: {
          hotel: {
            id: hotel.id,
            name: hotel.name,
            timeZone: hotel.timeZone,
            businessDate: hotel.businessDate,
          },
          freeRoomsText: notices.freeRooms(free),
          lastClose: await lastClose(pool, hotel.id),
        },
      };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/timeline',
    access: DESK_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const from = queryDate(ctx, 'from');
      const to = queryDate(ctx, 'to');
      const errors: Record<string, string> = {};
      if (from === null) errors.from = validationTexts.dateRange;
      if (to === null) errors.to = validationTexts.dateRange;
      if (from !== null && to !== null) {
        const nights = rangeNightCount(from, to);
        if (nights < 1 || nights > MAX_TIMELINE_NIGHTS) errors.to = validationTexts.dateRange;
      }
      if (Object.keys(errors).length > 0) throw invalid(errors);

      const rooms = await listRooms(pool, hotel.id);
      const blocks = await rows<BlockRow>(
        pool,
        `select sg.stay_id, sg.room_id, sg.first_night, sg.nights, s.status,
                g.name as guest_name, s.checked_in_online, s.version
           from stay_segments sg
           join stays s on s.id = sg.stay_id
           join guests g on g.id = s.guest_id
          where s.hotel_id = $1
            and sg.first_night <= $3::date
            and sg.first_night + sg.nights > $2::date
          order by sg.first_night`,
        [hotel.id, from, to],
      );
      return {
        status: 200,
        json: {
          businessDate: hotel.businessDate,
          dates: nightsOfRange(from as string, to as string),
          rooms,
          blocks: blocks.map((row) => ({
            stayId: row.stay_id,
            roomId: row.room_id,
            firstNight: row.first_night,
            nights: row.nights,
            status: row.status,
            guestName: row.guest_name,
            checkedInOnline: row.checked_in_online,
            version: row.version,
          })),
          stamps: await stampsFor(pool, hotel.id, from as string, to as string),
        },
      };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/live',
    access: BOARD_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      ctx.res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      ctx.res.write(': open\n\n');
      const unsubscribe = subscribe({
        hotelId: user.hotelId,
        role: user.role,
        send: (payload) => {
          ctx.res.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
        },
      });
      const keepAlive = setInterval(() => ctx.res.write(': tick\n\n'), 20000);
      const stop = (): void => {
        clearInterval(keepAlive);
        unsubscribe();
      };
      ctx.req.on('close', stop);
      ctx.req.on('error', stop);
      return { status: 0 };
    },
  });
}
