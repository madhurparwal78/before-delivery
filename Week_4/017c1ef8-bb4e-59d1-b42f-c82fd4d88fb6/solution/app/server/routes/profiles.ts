import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { MULTIPART_SLACK, config } from '../config.js';
import { pool, transaction } from '../db.js';
import { mutualsBetween } from '../domain/counts.js';
import { connectionPath } from '../domain/graph.js';
import { readPhoto, setProfilePhoto, uploadPhoto } from '../domain/media.js';
import { personCards } from '../domain/people.js';
import { ownerProjection, profileProjection, visibleMemberByHandle } from '../domain/profile-projection.js';
import { saveSection, saveVisibility } from '../domain/sections.js';
import { filePart } from '../uploads.js';

type Body = Record<string, unknown>;

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me', async (request) => ownerProjection(pool, memberOf(request).id));

  app.get<{ Params: { handle: string } }>('/api/profiles/:handle', async (request) => profileProjection(pool, memberOf(request).id, request.params.handle));

  app.get<{ Params: { handle: string } }>('/api/profiles/:handle/mutual', async (request) => {
    const viewer = memberOf(request);
    const member = await visibleMemberByHandle(pool, viewer.id, request.params.handle);
    const mutuals = member.id === viewer.id ? { count: 0, members: [] } : await mutualsBetween(pool, viewer.id, member.id);
    return { count: mutuals.count, members: await personCards(pool, viewer.id, mutuals.members.map((mutual) => mutual.id)) };
  });

  app.get<{ Params: { handle: string } }>('/api/profiles/:handle/path', async (request) => {
    const viewer = memberOf(request);
    const member = await visibleMemberByHandle(pool, viewer.id, request.params.handle);
    return { path: await connectionPath(pool, viewer.id, member.id) };
  });

  app.patch<{ Params: { section: string }; Body: Body | null }>('/api/me/sections/:section', async (request) => {
    const memberId = memberOf(request).id;
    return transaction((tx) => saveSection(tx, memberId, request.params.section, request.body ?? {}));
  });

  app.patch<{ Body: Body | null }>('/api/me/settings', async (request) => {
    const memberId = memberOf(request).id;
    return { visibility: await transaction((tx) => saveVisibility(tx, memberId, request.body?.visibility)) };
  });

  app.post('/api/uploads/photo', { config: { upload: true }, bodyLimit: config.photoMaxBytes + MULTIPART_SLACK }, async (request, reply) => {
    const stored = await uploadPhoto(pool, memberOf(request).id, await filePart(request.body));
    return reply.status(201).send(stored);
  });

  app.put<{ Body: Body | null }>('/api/me/photo', async (request) => ({ photo_url: await setProfilePhoto(pool, memberOf(request).id, request.body?.photo_id ?? undefined) }));

  app.delete('/api/me/photo', async (request) => ({ photo_url: await setProfilePhoto(pool, memberOf(request).id, null) }));

  app.get<{ Params: { id: string } }>('/media/photos/:id', async (request, reply) => {
    const photo = await readPhoto(pool, memberOf(request).id, request.params.id);
    return reply.header('Content-Type', photo.contentType).header('Cache-Control', 'private, max-age=3600').send(photo.bytes);
  });
}
