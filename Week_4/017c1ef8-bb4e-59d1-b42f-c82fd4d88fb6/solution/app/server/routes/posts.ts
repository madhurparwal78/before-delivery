import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { now } from '../clock.js';
import { pool, transaction } from '../db.js';
import { commentTree, createComment, deletableComment, deleteComment, resolveParent } from '../domain/comments.js';
import { hashtagPage } from '../domain/hashtags.js';
import { createPost, deletePost, editPost, postObject, resolveReferences, visiblePost } from '../domain/posts.js';
import { isReactionType, reactorsOf, removeReaction, setReaction } from '../domain/reactions.js';
import { createRepost, deleteRepost } from '../domain/reposts.js';
import { personCards } from '../domain/people.js';
import { forbidden, validation } from '../errors.js';
import { idempotent } from '../idempotency.js';

type Body = Record<string, unknown>;

const bodyOf = (request: { body: unknown }): Body => (typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body) ? (request.body as Body) : {});

const queryText = (query: unknown, name: string): string | null => {
  const value = (query as Body)[name];
  return typeof value === 'string' && value !== '' ? value : null;
};

export async function postRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/posts', async (request, reply) => {
    const viewer = memberOf(request);
    const input = bodyOf(request);
    const references = await resolveReferences(pool, viewer.id, { text: input.text, photo_id: input.photo_id, shared_post_id: input.shared_post_id });
    return idempotent(request, reply, async (tx) => {
      const id = await createPost(tx, viewer.id, { text: input.text, photo_id: input.photo_id, shared_post_id: input.shared_post_id }, references, now());
      return { status: 201, body: await postObject(tx, viewer.id, id) };
    });
  });

  app.get<{ Params: { id: string } }>('/api/posts/:id', async (request) => {
    const { id } = request.params;
    return postObject(pool, memberOf(request).id, id);
  });

  app.patch<{ Params: { id: string } }>('/api/posts/:id', async (request) => {
    const { id } = request.params;
    const viewer = memberOf(request);
    await transaction((tx) => editPost(tx, viewer.id, id, bodyOf(request).text, now()));
    return postObject(pool, viewer.id, id);
  });

  app.delete<{ Params: { id: string } }>('/api/posts/:id', async (request, reply) => {
    const { id } = request.params;
    await transaction((tx) => deletePost(tx, memberOf(request).id, id));
    return reply.status(204).send();
  });

  app.put<{ Params: { id: string } }>('/api/posts/:id/reaction', async (request) => {
    const { id } = request.params;
    const viewer = memberOf(request);
    const post = await visiblePost(pool, viewer.id, id);
    const type = bodyOf(request).type;
    if (!isReactionType(type)) throw validation({ type: 'Choose a reaction type.' });
    return { reactions: await transaction((tx) => setReaction(tx, viewer.id, post, type, now())) };
  });

  app.delete<{ Params: { id: string } }>('/api/posts/:id/reaction', async (request) => {
    const { id } = request.params;
    const viewer = memberOf(request);
    const post = await visiblePost(pool, viewer.id, id);
    return { reactions: await transaction((tx) => removeReaction(tx, viewer.id, post)) };
  });

  app.get<{ Params: { id: string } }>('/api/posts/:id/reactions', async (request) => {
    const { id } = request.params;
    const viewer = memberOf(request);
    await visiblePost(pool, viewer.id, id);
    const reactors = await reactorsOf(pool, viewer.id, id);
    const cards = new Map((await personCards(pool, viewer.id, reactors.map((reactor) => reactor.member_id))).map((card) => [card.id, card]));
    return { reactors: reactors.flatMap((reactor) => { const member = cards.get(reactor.member_id); return member ? [{ member, type: reactor.type, at: reactor.at }] : []; }) };
  });

  app.get<{ Params: { id: string } }>('/api/posts/:id/comments', async (request) => {
    const { id } = request.params;
    const viewer = memberOf(request);
    await visiblePost(pool, viewer.id, id);
    return { comments: await commentTree(pool, viewer.id, id) };
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/comments', async (request, reply) => {
    const { id } = request.params;
    const viewer = memberOf(request);
    const input = bodyOf(request);
    const post = await visiblePost(pool, viewer.id, id);
    const parent = await resolveParent(pool, viewer.id, id, input.parent_id);
    return idempotent(request, reply, async (tx) => ({ status: 201, body: await createComment(tx, viewer, post, { text: input.text, parent_id: input.parent_id }, parent, now()) }));
  });

  app.delete<{ Params: { id: string } }>('/api/comments/:id', async (request, reply) => {
    const { id } = request.params;
    const viewer = memberOf(request);
    const target = await deletableComment(pool, viewer.id, id);
    if (target.author_id !== viewer.id && target.post_author_id !== viewer.id) throw forbidden('not_author');
    await transaction((tx) => deleteComment(tx, target, now()));
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/reposts', async (request, reply) => {
    const { id } = request.params;
    const viewer = memberOf(request);
    const post = await visiblePost(pool, viewer.id, id);
    return reply.status(201).send(await transaction((tx) => createRepost(tx, viewer.id, post, now())));
  });

  app.delete<{ Params: { id: string } }>('/api/reposts/:id', async (request, reply) => {
    const { id } = request.params;
    await transaction((tx) => deleteRepost(tx, memberOf(request).id, id));
    return reply.status(204).send();
  });

  app.get<{ Params: { tag: string } }>('/api/hashtags/:tag', async (request) => {
    const { tag } = request.params;
    return hashtagPage(pool, memberOf(request).id, tag, queryText(request.query, 'cursor'));
  });
}
