import { tx } from '../db/pool.js';
import { newId } from '../domain/hash.js';
import { errors } from '../errors.js';
import type { Route } from '../router.js';
import {
  buildPacketContent,
  findPacket,
  issuePacket,
  listPackets,
  packetBytes,
  packetContentHash,
  startRender,
} from '../services/packets.js';
import { lockSession } from '../services/sessionStore.js';
import { requireSession } from './sessions.js';

export const packetRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/packets',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const record = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      return { status: 200, body: { packets: await listPackets(record.id) } };
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/packets/preview',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const record = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const content = buildPacketContent(record);
      return {
        status: 200,
        body: {
          session_version: record.session_version,
          content,
          content_hash: packetContentHash(record.session_version, content),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/packets',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const result = await ctx.once(async () => {
        ctx.requireRevision(preflight.session_version);
        const packetId = newId('pkt');
        const packet = await tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          if (record.session_version !== preflight.session_version) throw errors.staleRevision();
          return issuePacket(client, record, packetId, ctx.person.display_name);
        });
        return { status: 202, body: { packet } };
      });
      const body = result.body as { packet: { id: string; state: string } };
      if (body.packet.state === 'Queued') startRender(preflight.id, body.packet.id);
      return result;
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/packets/:packetId',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const record = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const packet = await findPacket(record.id, ctx.params['packetId']);
      if (!packet) throw errors.notFound();
      return { status: 200, body: packet };
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/packets/:packetId/pdf',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const record = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const packet = await findPacket(record.id, ctx.params['packetId']);
      if (!packet) throw errors.notFound();
      const bytes = await packetBytes(record.id, packet.id);
      if (!bytes || bytes.length === 0) throw errors.packetNoPdf();
      ctx.res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': bytes.length,
        'Content-Disposition': `inline; filename="crew-packet-${packet.id}.pdf"`,
        'Cache-Control': 'no-store',
      });
      ctx.res.end(bytes);
    },
  },
];
