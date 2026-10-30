import { PACKET_MAX_EXPIRY_DAYS, PACKET_MAX_RANGE_DAYS } from '../../../shared/domain.js';
import { daysBetween, parseInstantWithOffset, parseKitchenLocalInstant } from '../../../shared/time.js';
import { newId } from '../../db/seed.js';
import {
  buildSnapshot,
  findPacket,
  findUsablePacketByToken,
  newPacketToken,
  packetStatus,
  packetStorageKey,
  packetView,
  renderPacketPdf,
  type PacketRow,
} from '../../domain/packets.js';
import type { RequestContext } from '../context.js';
import { conflict, invalidField, notFound } from '../errors.js';
import { route, type Route } from '../router.js';
import { requireDate, requireString } from '../validate.js';

const PACKET_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

function readExpiry(ctx: RequestContext, raw: string): Date {
  const parsed =
    parseInstantWithOffset(raw) ?? parseKitchenLocalInstant(raw, ctx.app.config.timeZone);
  if (parsed === null) throw invalidField('expires_at', 'not_in_future');
  if (parsed.getTime() <= ctx.now.getTime()) throw invalidField('expires_at', 'not_in_future');
  if (parsed.getTime() - ctx.now.getTime() > PACKET_MAX_EXPIRY_DAYS * 86400000) {
    throw invalidField('expires_at', 'too_far');
  }
  return parsed;
}

async function storeSnapshotPdf(
  ctx: RequestContext,
  packetId: string,
  snapshot: Awaited<ReturnType<typeof buildSnapshot>>,
): Promise<void> {
  await ctx.app.storage.putObject(
    packetStorageKey(packetId),
    renderPacketPdf(snapshot),
    'application/pdf',
  );
}

export const packetRoutes: Route[] = [
  route({
    method: 'POST',
    path: '/packets',
    roles: ['operator'],
    handle: async (ctx) => {
      const from = requireDate(ctx.body, 'from');
      const to = requireDate(ctx.body, 'to');
      if (daysBetween(from, to) < 0) throw invalidField('to', 'before_from');
      if (daysBetween(from, to) + 1 > PACKET_MAX_RANGE_DAYS) {
        throw invalidField('to', 'range_too_long');
      }
      const expiresAt = readExpiry(ctx, requireString(ctx.body, 'expires_at'));

      const id = newId('pkt');
      const snapshot = await buildSnapshot(
        ctx.app.db,
        from,
        to,
        ctx.now,
        ctx.app.config.timeZone,
      );
      await storeSnapshotPdf(ctx, id, snapshot);

      const inserted = await ctx.app.db.query<PacketRow>(
        `INSERT INTO packets (id, from_date, to_date, expires_at, status, token, snapshot, created_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $6, $7)
         RETURNING id, from_date, to_date, expires_at, status, token, snapshot, created_at`,
        [id, from, to, expiresAt, newPacketToken(), JSON.stringify(snapshot), ctx.now],
      );
      return {
        status: 201,
        body: {
          packet: packetView(inserted.rows[0] as PacketRow, ctx.now, ctx.app.config.timeZone),
        },
      };
    },
  }),

  route({
    method: 'GET',
    path: '/packets',
    roles: ['operator'],
    handle: async (ctx) => {
      const result = await ctx.app.db.query<PacketRow>(
        `SELECT id, from_date, to_date, expires_at, status, token, snapshot, created_at
           FROM packets ORDER BY created_at DESC, id`,
      );
      return {
        status: 200,
        body: {
          packets: result.rows.map((row) => packetView(row, ctx.now, ctx.app.config.timeZone)),
        },
      };
    },
  }),

  route<PacketRow>({
    method: 'POST',
    path: '/packets/:id/revoke',
    roles: ['operator'],
    resolve: async (ctx) => {
      const packet = await findPacket(ctx.app.db, ctx.req.params['id'] as string);
      if (packet === null) throw notFound();
      return packet;
    },
    handle: async (ctx, packet) => {
      if (packet.status === 'revoked') throw conflict('invalid_transition');
      const updated = await ctx.app.db.query<PacketRow>(
        `UPDATE packets SET status = 'revoked', token = NULL WHERE id = $1 AND status = 'active'
         RETURNING id, from_date, to_date, expires_at, status, token, snapshot, created_at`,
        [packet.id],
      );
      const row = updated.rows[0];
      if (row === undefined) throw conflict('invalid_transition');
      return { status: 200, body: { packet: packetView(row, ctx.now, ctx.app.config.timeZone) } };
    },
  }),

  route<PacketRow>({
    method: 'POST',
    path: '/packets/:id/regenerate',
    roles: ['operator'],
    resolve: async (ctx) => {
      const packet = await findPacket(ctx.app.db, ctx.req.params['id'] as string);
      if (packet === null) throw notFound();
      return packet;
    },
    handle: async (ctx, packet) => {
      // Revoking is final, so only an active or expired packet can be reissued.
      if (packetStatus(packet, ctx.now) === 'revoked') throw conflict('invalid_transition');
      const rawExpiry = ctx.body['expires_at'];
      const expiresAt =
        typeof rawExpiry === 'string' ? readExpiry(ctx, rawExpiry) : packet.expires_at;
      if (expiresAt.getTime() <= ctx.now.getTime()) {
        throw invalidField('expires_at', 'not_in_future');
      }

      const snapshot = await buildSnapshot(
        ctx.app.db,
        packet.from_date,
        packet.to_date,
        ctx.now,
        ctx.app.config.timeZone,
      );
      await storeSnapshotPdf(ctx, packet.id, snapshot);

      const updated = await ctx.app.db.query<PacketRow>(
        `UPDATE packets SET token = $2, snapshot = $3, expires_at = $4, status = 'active'
          WHERE id = $1 AND status = 'active'
         RETURNING id, from_date, to_date, expires_at, status, token, snapshot, created_at`,
        [packet.id, newPacketToken(), JSON.stringify(snapshot), expiresAt],
      );
      const row = updated.rows[0];
      if (row === undefined) throw conflict('invalid_transition');
      return { status: 200, body: { packet: packetView(row, ctx.now, ctx.app.config.timeZone) } };
    },
  }),

  route<PacketRow>({
    method: 'GET',
    path: '/packet/:token',
    public: true,
    resolve: async (ctx) => {
      const packet = await findUsablePacketByToken(
        ctx.app.db,
        ctx.req.params['token'] as string,
        ctx.now,
      );
      if (packet === null) throw notFound();
      return packet;
    },
    handle: async (_ctx, packet) => ({
      status: 200,
      body: packet.snapshot,
      headers: PACKET_HEADERS,
    }),
  }),

  route<PacketRow>({
    method: 'GET',
    path: '/packet/:token/pdf',
    public: true,
    resolve: async (ctx) => {
      const packet = await findUsablePacketByToken(
        ctx.app.db,
        ctx.req.params['token'] as string,
        ctx.now,
      );
      if (packet === null) throw notFound();
      return packet;
    },
    handle: async (ctx, packet) => {
      const stored = await ctx.app.storage.getObject(packetStorageKey(packet.id));
      const pdf = stored?.body ?? renderPacketPdf(packet.snapshot);
      return {
        status: 200,
        buffer: pdf,
        headers: {
          ...PACKET_HEADERS,
          'Content-Type': 'application/pdf',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': 'sandbox',
          'Content-Disposition':
            `attachment; filename="compliance-packet-${packet.from_date}-to-${packet.to_date}.pdf"`,
        },
      };
    },
  }),
];
