import { one, pool, withTransaction } from '../db';
import { config } from '../config';
import { notFoundError } from '../http/errors';
import { Router, RequestContext } from '../http/router';
import { originOf } from '../http/app';
import { createHotelFromSpec, SetupError, SetupIds, staysNeedingLink } from '../repo/setup';
import { loadHotel } from '../repo/hotels';
import { checkinLinkUrl, newToken, storeToken } from '../repo/checkinLinks';
import { fileStoreReachable } from '../services/fileStore';
import { mailReachable, mailTexts, sendMessage } from '../services/mail';
import { pdfServiceReachable } from '../services/pdf';
import { ProviderDownError } from '../services/providers';

const GRADING_HEADER = 'x-grading-key';

function requireGradingKey(ctx: RequestContext): void {
  const provided = ctx.req.headers[GRADING_HEADER];
  if (config.gradingKey === '' || typeof provided !== 'string' || provided !== config.gradingKey) {
    throw notFoundError();
  }
}

async function databaseReachable(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}

async function sendSetupLinks(
  spec: Record<string, unknown>,
  ids: SetupIds,
  origin: string,
): Promise<void> {
  const hotel = await loadHotel(pool, ids.hotelId);
  if (!hotel) return;
  for (const key of staysNeedingLink(spec)) {
    const stayId = ids.stays[key];
    if (!stayId) continue;
    const guest = await one<{ email: string }>(
      pool,
      'select g.email from stays s join guests g on g.id = s.guest_id where s.id = $1',
      [stayId],
    );
    if (!guest || guest.email === '') continue;
    const token = newToken();
    try {
      await sendMessage({
        to: guest.email,
        subject: mailTexts.checkinSubject(hotel.name),
        text: mailTexts.checkinBody(checkinLinkUrl(origin, token)),
      });
      await storeToken(pool, hotel, stayId, token);
    } catch (error) {
      if (!(error instanceof ProviderDownError)) throw error;
    }
  }
}

export function registerSystemRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/health',
    access: 'public',
    bodyMode: 'none',
    handler: async () => {
      const probes = await Promise.all([
        databaseReachable(),
        pdfServiceReachable(),
        fileStoreReachable(),
        mailReachable(),
      ]);
      return {
        status: 200,
        json: { status: probes.every((ok) => ok) ? 'ok' : 'unavailable' },
      };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/grading/setup',
    access: 'public',
    bodyMode: 'json',
    handler: async (ctx) => {
      requireGradingKey(ctx);
      try {
        const result = await withTransaction(async (db) => {
          const main = await createHotelFromSpec(db, ctx.body);
          const second = ctx.body.secondHotel;
          const secondIds =
            second === undefined || second === null ? null : await createHotelFromSpec(db, second);
          return { main, secondIds };
        });
        await sendSetupLinks(ctx.body, result.main, originOf(ctx.req));
        if (result.secondIds && ctx.body.secondHotel) {
          await sendSetupLinks(
            ctx.body.secondHotel as Record<string, unknown>,
            result.secondIds,
            originOf(ctx.req),
          );
        }
        return {
          status: 201,
          json: {
            ...result.main,
            ...(result.secondIds ? { secondHotel: result.secondIds } : {}),
          },
        };
      } catch (error) {
        if (error instanceof SetupError) {
          return { status: 422, json: { errors: { setup: error.message } } };
        }
        throw error;
      }
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/grading/clock',
    access: 'public',
    bodyMode: 'json',
    handler: async (ctx) => {
      requireGradingKey(ctx);
      const hotelId = typeof ctx.body.hotelId === 'string' ? ctx.body.hotelId : '';
      const hotel = await loadHotel(pool, hotelId);
      if (!hotel) throw notFoundError();
      const nowText = ctx.body.now;
      let clockNow: Date | null = null;
      if (nowText !== null && nowText !== undefined) {
        const parsed = new Date(String(nowText));
        if (Number.isNaN(parsed.getTime())) {
          return { status: 422, json: { errors: { now: 'Enter a valid instant.' } } };
        }
        clockNow = parsed;
      }
      await pool.query('update hotels set clock_now = $2 where id = $1', [hotelId, clockNow]);
      return {
        status: 200,
        json: { hotelId, now: clockNow === null ? null : clockNow.toISOString() },
      };
    },
  });
}
