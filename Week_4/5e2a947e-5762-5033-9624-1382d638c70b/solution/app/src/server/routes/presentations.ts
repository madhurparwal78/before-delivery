import { ApiError } from '../../shared/errors.ts';
import type { PresentationInfo, PresentationState } from '../../shared/model.ts';
import { can } from '../../shared/rules.ts';
import { requirePrincipal } from '../auth.ts';
import { database, withMapLock } from '../db.ts';
import { Effects, emitEvent } from '../groups.ts';
import { joinAudience, keepAlive, leaveAudience } from '../hub.ts';
import { bodyObject, json, route, type Ctx } from '../http.ts';
import { accessMap } from '../mapStore.ts';
import {
  announceFollowers,
  assertNoActiveSession,
  assertNotEnded,
  assertPresenterTransition,
  assertStepping,
  audiencePayload,
  createPresentation,
  sessionByCode,
  sessionById,
  stepTo,
  switchState,
  type Session,
} from '../presentations.ts';
import { acceptUpgrade, upgradeRoute } from '../upgrade.ts';
import { resolveMap, scopeOf } from './maps.ts';

const STATES: readonly PresentationState[] = ['waiting', 'live', 'paused', 'ended'];

const sessionOf = (ctx: Ctx): Session => ctx.scope.session as Session;

/** Resolve a session by id and the caller's access to its map, the way resolveMap does for a map. */
const resolveSession = async (ctx: Ctx): Promise<void> => {
  const session = await sessionById(database(), ctx.params.pid ?? '');
  ctx.scope.session = session;
  ctx.scope.access = await accessMap(database(), session.map_id, ctx.principal as NonNullable<Ctx['principal']>);
};

const authorizePresent = (ctx: Ctx): void => {
  if (!can(scopeOf(ctx).role, 'present')) throw new ApiError('forbidden', 'Only the owner can present.');
};

const askedState = (ctx: Ctx): PresentationState | undefined => STATES.find((state) => state === bodyObject(ctx).to);

/** The state a request asks for, or a 422. */
function requestedState(ctx: Ctx): PresentationState {
  const found = askedState(ctx);
  if (!found) throw new ApiError('invalid', 'to must be live or ended.', { fields: { to: 'to must be live or ended.' } });
  return found;
}

/** The slide index a request asks for, or a 422. */
function requestedSlide(ctx: Ctx): number {
  const index = bodyObject(ctx).index;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= scopeOf(ctx).map.doc.slides.length) {
    throw new ApiError('invalid', 'index must be the position of a slide.', { fields: { index: 'index must be the position of a slide.' } });
  }
  return index;
}

route('POST', '/api/maps/:id/presentations', {
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveMap,
    authorize: authorizePresent,
    state: (ctx) => assertNoActiveSession(database(), scopeOf(ctx).map.id),
  },
  handle: async (ctx) => {
    const { map } = scopeOf(ctx);
    const principal = ctx.principal as NonNullable<Ctx['principal']>;
    const fx = new Effects();
    const presentation = await withMapLock(map.id, async (client): Promise<PresentationInfo> => {
      await assertNoActiveSession(client, map.id);
      const created = await createPresentation(client, { mapId: map.id, presenterId: principal.id, presenterName: principal.name });
      const info: PresentationInfo = { ...created, state: 'waiting', slide_index: 0, followers: 0 };
      await emitEvent(client, map.id, { type: 'presentation', presentation: info, skipped: [] }, 'user', principal.id, fx);
      return info;
    });
    fx.run();
    return json(201, { presentation });
  },
});

route('POST', '/api/presentations/:pid/state', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveSession,
    authorize: authorizePresent,
    state: (ctx) => {
      const to = askedState(ctx);
      if (to) assertPresenterTransition(sessionOf(ctx), to);
      else assertNotEnded(sessionOf(ctx));
    },
    validate: (ctx) => void requestedState(ctx),
  },
  handle: async (ctx) => {
    const to = requestedState(ctx);
    const fx = new Effects();
    const presentation = await withMapLock(sessionOf(ctx).map_id, async (client) => {
      const session = await sessionById(client, sessionOf(ctx).id);
      assertPresenterTransition(session, to);
      return switchState(client, fx, session, to);
    });
    fx.run();
    return json(200, { presentation });
  },
});

route('POST', '/api/presentations/:pid/step', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveSession,
    authorize: authorizePresent,
    state: (ctx) => assertStepping(sessionOf(ctx)),
    validate: (ctx) => void requestedSlide(ctx),
  },
  handle: async (ctx) => {
    const index = requestedSlide(ctx);
    const fx = new Effects();
    const stepped = await withMapLock(sessionOf(ctx).map_id, async (client) => {
      const session = await sessionById(client, sessionOf(ctx).id);
      assertStepping(session);
      return stepTo(client, fx, session, index);
    });
    fx.run();
    return json(200, stepped);
  },
});

route('GET', '/api/presentations/by-code/:code', {
  stages: {
    resolve: async (ctx) => {
      ctx.scope.session = await sessionByCode(database(), ctx.params.code ?? '');
    },
  },
  handle: async (ctx) => json(200, await audiencePayload(database(), sessionOf(ctx))),
});

upgradeRoute('/api/presentations/by-code/:code/live', async (ctx) => {
  const { code } = await sessionByCode(database(), ctx.params.code ?? '');
  const ws = await acceptUpgrade(ctx);
  joinAudience(code, ws);
  const stopPing = keepAlive(ws);
  ws.on('error', () => ws.terminate());
  ws.on('close', () => {
    stopPing();
    leaveAudience(code, ws);
    void announceFollowers(code);
  });
  await announceFollowers(code);
});
