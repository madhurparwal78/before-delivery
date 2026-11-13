import type { IncomingMessage } from 'node:http';
import {
  accountForSession,
  clearedCookie,
  requireAccount,
  sessionCookie,
  signIn,
  signOut,
  signUp,
  type SignedInAccount,
} from './auth.js';
import { query } from './db.js';
import { notFound, storageUnavailable } from './errors.js';
import {
  bytesReply,
  emptyReply,
  jsonReply,
  type Reply,
} from './http.js';
import { addBarlow, addEyepiece, addSite, addTelescope, readKit, readSites } from './kit.js';
import {
  checkPacket,
  createPacket,
  getPacket,
  listPackets,
  readPacketPdf,
  readPacketStrokes,
  replaceRows,
  sendPacket,
  startRender,
} from './packets.js';
import { followProgram, getProgram, listPrograms, unfollowProgram } from './programs.js';
import {
  readObjectHistory,
  readObservation,
  readSession,
  readSessionObservations,
  readSessions,
  toObservation,
  toSession,
} from './records.js';
import { getObject, rasterKey, StorageDown, strokesKey } from './storage.js';
import { applySync } from './sync.js';
import type { CatalogueObject } from '../shared/types.js';

export interface RouteRequest {
  method: string;
  segments: string[];
  url: URL;
  body: Record<string, unknown>;
  raw: IncomingMessage;
  sessionId: string | undefined;
}

type Handler = (request: RouteRequest, account: SignedInAccount) => Promise<Reply>;

async function readCatalogue(): Promise<CatalogueObject[]> {
  const found = await query<CatalogueObject>(
    'SELECT id, designation, name, kind FROM catalogue_objects ORDER BY position',
  );
  return found.rows;
}

async function sketchBytes(
  accountId: string,
  observationId: string,
  kind: 'strokes' | 'raster',
): Promise<Uint8Array> {
  const row = await readObservation(accountId, observationId);
  if (kind === 'strokes') {
    if (!row.strokes_has_marks || !row.strokes_sha256) throw notFound();
    try {
      return await getObject(strokesKey(accountId, observationId, row.strokes_sha256));
    } catch (error) {
      if (error instanceof StorageDown) throw storageUnavailable();
      throw error;
    }
  }
  if (!row.raster_sha256) throw notFound();
  try {
    return await getObject(rasterKey(accountId, observationId, row.raster_sha256));
  } catch (error) {
    if (error instanceof StorageDown) throw storageUnavailable();
    throw error;
  }
}

/** Routes that need no sign-in. */
export async function publicRoute(request: RouteRequest): Promise<Reply | null> {
  const { method, segments } = request;
  const path = segments.join('/');
  if (method === 'GET' && path === 'health') {
    return jsonReply(200, { status: 'ok' });
  }
  if (method === 'POST' && path === 'auth/signup') {
    const result = await signUp(request.body);
    return jsonReply(
      201,
      { account: result.account },
      { 'set-cookie': sessionCookie(result.sessionId) },
    );
  }
  if (method === 'POST' && path === 'auth/signin') {
    const result = await signIn(request.body);
    return jsonReply(
      200,
      { account: result.account },
      { 'set-cookie': sessionCookie(result.sessionId) },
    );
  }
  if (method === 'POST' && path === 'auth/signout') {
    const account = await accountForSession(request.sessionId);
    if (!account) return emptyReply(204, { 'set-cookie': clearedCookie() });
    await signOut(request.sessionId);
    return emptyReply(204, { 'set-cookie': clearedCookie() });
  }
  return null;
}

const GUARDED: Array<{ method: string; pattern: string; handler: Handler }> = [
  {
    method: 'GET',
    pattern: 'auth/me',
    handler: async (_request, account) =>
      jsonReply(200, {
        account: { id: account.id, email: account.email, display_name: account.display_name },
      }),
  },
  {
    method: 'GET',
    pattern: 'kit',
    handler: async (_request, account) => jsonReply(200, await readKit(account.id)),
  },
  {
    method: 'POST',
    pattern: 'kit/telescopes',
    handler: async (request, account) =>
      jsonReply(201, await addTelescope(account.id, request.body)),
  },
  {
    method: 'POST',
    pattern: 'kit/eyepieces',
    handler: async (request, account) =>
      jsonReply(201, await addEyepiece(account.id, request.body)),
  },
  {
    method: 'POST',
    pattern: 'kit/barlows',
    handler: async (request, account) => jsonReply(201, await addBarlow(account.id, request.body)),
  },
  {
    method: 'GET',
    pattern: 'sites',
    handler: async (_request, account) => jsonReply(200, { sites: await readSites(account.id) }),
  },
  {
    method: 'POST',
    pattern: 'sites',
    handler: async (request, account) => jsonReply(201, await addSite(account.id, request.body)),
  },
  {
    method: 'GET',
    pattern: 'objects',
    handler: async () => jsonReply(200, { objects: await readCatalogue() }),
  },
  {
    method: 'GET',
    pattern: 'objects/:id/history',
    handler: async (request, account) => {
      const objectId = request.segments[1] as string;
      const catalogue = await readCatalogue();
      const object = catalogue.find((entry) => entry.id === objectId);
      if (!object) throw notFound();
      const [kit, rows] = await Promise.all([
        readKit(account.id),
        readObjectHistory(account.id, objectId),
      ]);
      return jsonReply(200, {
        object,
        observations: rows.map((row) => toObservation(row, kit)),
      });
    },
  },
  {
    method: 'GET',
    pattern: 'sessions',
    handler: async (_request, account) => {
      const [kit, rows] = await Promise.all([readKit(account.id), readSessions(account.id)]);
      return jsonReply(200, { sessions: rows.map((row) => toSession(row, kit)) });
    },
  },
  {
    method: 'GET',
    pattern: 'sessions/:id',
    handler: async (request, account) => {
      const sessionId = request.segments[1] as string;
      const kit = await readKit(account.id);
      const session = await readSession(account.id, sessionId);
      const observations = await readSessionObservations(account.id, sessionId);
      return jsonReply(200, {
        ...toSession(session, kit),
        observations: observations.map((row) => toObservation(row, kit)),
      });
    },
  },
  {
    method: 'GET',
    pattern: 'observations/:id',
    handler: async (request, account) => {
      const kit = await readKit(account.id);
      const row = await readObservation(account.id, request.segments[1] as string);
      return jsonReply(200, toObservation(row, kit));
    },
  },
  {
    method: 'GET',
    pattern: 'observations/:id/strokes',
    handler: async (request, account) => {
      const bytes = await sketchBytes(account.id, request.segments[1] as string, 'strokes');
      return bytesReply(200, bytes, 'application/json');
    },
  },
  {
    method: 'GET',
    pattern: 'observations/:id/raster',
    handler: async (request, account) => {
      const bytes = await sketchBytes(account.id, request.segments[1] as string, 'raster');
      return bytesReply(200, bytes, 'image/png');
    },
  },
  {
    method: 'POST',
    pattern: 'sync',
    handler: async (request, account) => jsonReply(200, await applySync(account.id, request.body)),
  },
  {
    method: 'GET',
    pattern: 'programs',
    handler: async (_request, account) =>
      jsonReply(200, { programs: await listPrograms(account.id) }),
  },
  {
    method: 'GET',
    pattern: 'programs/:id',
    handler: async (request, account) =>
      jsonReply(200, await getProgram(account.id, request.segments[1] as string)),
  },
  {
    method: 'POST',
    pattern: 'programs/:id/follow',
    handler: async (request, account) => {
      await followProgram(account.id, request.segments[1] as string);
      return jsonReply(200, { following: true });
    },
  },
  {
    method: 'DELETE',
    pattern: 'programs/:id/follow',
    handler: async (request, account) => {
      await unfollowProgram(account.id, request.segments[1] as string);
      return jsonReply(200, { following: false });
    },
  },
  {
    method: 'POST',
    pattern: 'packets',
    handler: async (request, account) =>
      jsonReply(201, await createPacket(account.id, request.body)),
  },
  {
    method: 'GET',
    pattern: 'packets',
    handler: async (_request, account) =>
      jsonReply(200, { packets: await listPackets(account.id) }),
  },
  {
    method: 'GET',
    pattern: 'packets/:id',
    handler: async (request, account) =>
      jsonReply(200, await getPacket(account.id, request.segments[1] as string)),
  },
  {
    method: 'PUT',
    pattern: 'packets/:id/rows',
    handler: async (request, account) =>
      jsonReply(200, await replaceRows(account.id, request.segments[1] as string, request.body)),
  },
  {
    method: 'POST',
    pattern: 'packets/:id/check',
    handler: async (request, account) =>
      jsonReply(200, await checkPacket(account.id, request.segments[1] as string, request.body)),
  },
  {
    method: 'POST',
    pattern: 'packets/:id/render',
    handler: async (request, account) =>
      jsonReply(202, await startRender(account, request.segments[1] as string, request.body)),
  },
  {
    method: 'POST',
    pattern: 'packets/:id/send',
    handler: async (request, account) =>
      jsonReply(200, await sendPacket(account, request.segments[1] as string, request.body)),
  },
  {
    method: 'GET',
    pattern: 'packets/:id/pdf',
    handler: async (request, account) => {
      const pdf = await readPacketPdf(account.id, request.segments[1] as string);
      return bytesReply(200, pdf.bytes, 'application/pdf', {
        'content-disposition': `attachment; filename="${pdf.filename}"`,
      });
    },
  },
  {
    method: 'GET',
    pattern: 'packets/:id/strokes/:observationId',
    handler: async (request, account) => {
      const bytes = await readPacketStrokes(
        account.id,
        request.segments[1] as string,
        request.segments[3] as string,
      );
      return bytesReply(200, bytes, 'application/json');
    },
  },
];

function patternMatches(pattern: string, segments: string[]): boolean {
  const parts = pattern.split('/');
  if (parts.length !== segments.length) return false;
  return parts.every(
    (part, index) => part.startsWith(':') || part === segments[index],
  );
}

export async function apiRoute(request: RouteRequest): Promise<Reply> {
  const open = await publicRoute(request);
  if (open) return open;

  const route = GUARDED.find(
    (entry) => entry.method === request.method && patternMatches(entry.pattern, request.segments),
  );
  if (!route) throw notFound();
  const account = await requireAccount(request.sessionId);
  const reply = await route.handler(request, account);
  if (request.method === 'GET') reply.headers['cache-control'] = 'no-store';
  return reply;
}
