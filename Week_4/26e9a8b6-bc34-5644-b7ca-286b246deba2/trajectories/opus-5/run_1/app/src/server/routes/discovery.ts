import { config } from '../config.js';
import { invalid, notFound, rateLimited } from '../http/errors.js';
import { sendJson } from '../http/respond.js';
import { cursorOf, guideAccess, pageLimit, requireConfirmed, viewerOf } from '../http/context.js';
import type { Route } from '../http/router.js';
import { searchGuides, tagSuggestions } from '../domain/search.js';
import {
  addToCollection,
  answerQuestion,
  askerOf,
  askQuestion,
  createCollection,
  loadCollection,
  loadQuestion,
  moveInCollection,
  questionsForGuide,
} from '../domain/engagement.js';
import { isOwner, loadGuide, mayEdit, maySee, readableSnapshot } from '../domain/guides.js';
import { checkRate, recordRateEvent } from '../domain/ratelimit.js';
import { guideTopic, live, userTopic } from '../live.js';
import { codePointLength } from '../../shared/limits.js';
import { tooLong } from '../http/errors.js';

function readString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw invalid(field);
  return value;
}

export const discoveryRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/search',
    body: 'none',
    handle: async (exchange) => {
      const url = exchange.url;
      sendJson(
        exchange.res,
        exchange.isEmbed,
        200,
        await searchGuides({
          q: url.searchParams.get('q') ?? '',
          tags: url.searchParams.getAll('tag'),
          cursor: cursorOf(url),
          limit: pageLimit(url),
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/api/tags',
    body: 'none',
    handle: async (exchange) => {
      const prefix = exchange.url.searchParams.get('prefix') ?? '';
      sendJson(exchange.res, exchange.isEmbed, 200, { items: await tagSuggestions(prefix) });
    },
  },
  {
    method: 'POST',
    path: '/api/collections',
    body: 'json',
    handle: async (exchange) => {
      const user = requireConfirmed(await viewerOf(exchange));
      const body = exchange.json<Record<string, unknown>>();
      const visibility = body['visibility'] ?? 'public';
      if (visibility !== 'public' && visibility !== 'private') throw invalid('visibility');
      const created = await createCollection(user.id, readString(body, 'title'), visibility);
      sendJson(exchange.res, exchange.isEmbed, 201, created);
    },
  },
  {
    method: 'GET',
    path: '/api/collections/:id',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const collection = await loadCollection(exchange.params['id'] ?? '', viewer?.id ?? null);
      if (collection === null) throw notFound();
      sendJson(exchange.res, exchange.isEmbed, 200, {
        id: collection.id,
        slug: collection.slug,
        title: collection.title,
        visibility: collection.visibility,
        owner_name: collection.owner_name,
        items: collection.items,
      });
    },
  },
  {
    method: 'POST',
    path: '/api/collections/:id/items',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const collection = await loadCollection(exchange.params['id'] ?? '', viewer?.id ?? null);
      if (collection === null) throw notFound();
      const user = requireConfirmed(viewer);
      if (collection.owner_id !== user.id) throw notFound();
      const body = exchange.json<Record<string, unknown>>();
      const guideId = readString(body, 'guide_id');
      const guide = await loadGuide(guideId);
      if (guide === null || !(await maySee(guide, user))) throw notFound();
      const addable =
        isOwner(guide, user) || (guide.visibility === 'public' && guide.state === 'published');
      if (!addable) throw notFound();
      const position = await addToCollection(collection.id, guide.id);
      sendJson(exchange.res, exchange.isEmbed, 201, { position });
    },
  },
  {
    method: 'POST',
    path: '/api/collections/:id/items/:guideId/move',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const collection = await loadCollection(exchange.params['id'] ?? '', viewer?.id ?? null);
      if (collection === null) throw notFound();
      const user = requireConfirmed(viewer);
      if (collection.owner_id !== user.id) throw notFound();
      const body = exchange.json<Record<string, unknown>>();
      const position = body['position'];
      if (typeof position !== 'number') throw invalid('position');
      const order = await moveInCollection(
        collection.id,
        exchange.params['guideId'] ?? '',
        position,
      );
      sendJson(exchange.res, exchange.isEmbed, 200, { order });
    },
  },
  {
    method: 'GET',
    path: '/api/guides/:id/questions',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'see', {
        allowWithdrawn: true,
      });
      sendJson(
        exchange.res,
        exchange.isEmbed,
        200,
        await questionsForGuide(guide.id, cursorOf(exchange.url), pageLimit(exchange.url)),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/guides/:id/questions',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'session');
      const user = requireConfirmed(viewer);
      const body = exchange.json<Record<string, unknown>>();
      const step = body['step'];
      if (typeof step !== 'number') throw invalid('step');
      const text = readString(body, 'text');
      if (codePointLength(text) > config.limits.question_text_max) {
        throw tooLong('text', config.limits.question_text_max);
      }

      const readable = await readableSnapshot(guide, viewer);
      if (readable === null) throw notFound();
      const stepCount = readable.snapshot.steps.length;
      if (!Number.isInteger(step) || step < 1 || step > stepCount) throw invalid('step');

      const verdict = await checkRate(
        'question',
        user.id,
        config.limits.question_limit,
        config.limits.question_window_seconds,
      );
      if (!verdict.allowed) throw rateLimited(verdict.retryAfter);

      const question = await askQuestion(guide.id, step, text, user.id, stepCount);
      await recordRateEvent('question', user.id);
      live.publish(
        {
          kind: 'question',
          guide: guide.id,
          guide_title: readable.snapshot.title,
          question,
          asker_id: user.id,
        },
        [guideTopic(guide.id), userTopic(guide.owner_id)],
      );
      sendJson(exchange.res, exchange.isEmbed, 201, question);
    },
  },
  {
    method: 'POST',
    path: '/api/questions/:id/answer',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const questionId = exchange.params['id'] ?? '';
      const existing = await loadQuestion(questionId);
      if (existing === null) throw notFound();
      const { guide } = await guideAccess(existing.guide_id, viewer, 'edit', {
        allowWithdrawn: true,
      });
      const user = requireConfirmed(viewer);
      if (!(await mayEdit(guide, user))) throw notFound();
      const body = exchange.json<Record<string, unknown>>();
      const askerId = await askerOf(questionId);
      const answered = await answerQuestion(questionId, readString(body, 'text'), user.id);
      const readable = await readableSnapshot(guide, viewer);
      live.publish(
        {
          kind: 'answer',
          guide: guide.id,
          guide_title: readable?.snapshot.title ?? guide.title,
          question: answered,
          step: answered.step,
          author_name: user.name,
          asker_id: askerId ?? '',
        },
        [guideTopic(guide.id), ...(askerId === null ? [] : [userTopic(askerId)])],
      );
      sendJson(exchange.res, exchange.isEmbed, 201, answered);
    },
  },
];
