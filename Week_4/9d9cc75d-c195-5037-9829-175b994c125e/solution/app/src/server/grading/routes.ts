// Grading routes: mounted only when LOZ_GRADING is on, so otherwise each is an unknown path (404 not_found).
import { findUser } from '../auth/accounts.ts';
import { startSession } from '../auth/sessions.ts';
import { forceFailures } from '../extracts/schedule.ts';
import { tick } from '../extracts/ticker.ts';
import type { Module } from '../http/app.ts';
import { invalid, notFound } from '../http/errors.ts';
import { json } from '../http/reply.ts';
import { isString } from '../http/validate.ts';
import { replaceTable, sourceSummary } from '../sources/ingest.ts';
import { emptyIds, sourceIdOf } from './seed.ts';
import { registerPlatformSeed } from './steps.ts';

export const mountGrading: Module = (app) => {
  registerPlatformSeed(app);
  if (!app.config.grading) return;

  app.publicRoute({
    method: 'POST',
    path: '/api/grading/seed',
    body: 'json',
    handler: async (ctx) => {
      const body = ctx.object();
      const ids = emptyIds();
      for (const step of app.seedSteps) await step.run(app, body, ids);
      return json(201, ids);
    },
  });

  app.publicRoute({
    method: 'POST',
    path: '/api/grading/session',
    body: 'json',
    handler: async (ctx) => {
      const username = ctx.object().username;
      const user = isString(username) ? await findUser(app, username) : null;
      if (!user) throw notFound();
      return json(200, { user }, { 'Set-Cookie': await startSession(app, user.id) });
    },
  });

  app.publicRoute({
    method: 'POST',
    path: '/api/grading/clock',
    body: 'json',
    handler: async (ctx) => {
      const body = ctx.object();
      if (isString(body.set) && !Number.isNaN(Date.parse(body.set))) {
        app.clock.set(Date.parse(body.set));
      } else if (typeof body.advance_ms === 'number' && Number.isFinite(body.advance_ms)) {
        app.clock.advance(body.advance_ms);
      } else {
        throw invalid({ clock: 'invalid' });
      }
      await tick(app);
      const now = app.clock.iso();
      app.events.toAll('clock', { server_now: now });
      return json(200, { now });
    },
  });

  app.publicRoute({
    method: 'POST',
    path: '/api/grading/storage',
    body: 'json',
    handler: (ctx) => {
      const down = ctx.object().down;
      if (typeof down !== 'boolean') throw invalid({ down: 'invalid' });
      app.storage.setDown(down);
      return json(200, { down });
    },
  });

  app.publicRoute({
    method: 'POST',
    path: '/api/grading/source-file',
    body: 'json',
    handler: async (ctx) => {
      const body = ctx.object();
      const sourceId = await sourceIdOf(app, emptyIds(), body.source);
      if (!isString(body.table) || !isString(body.csv)) throw invalid({ csv: 'invalid' });
      await replaceTable(app, sourceId, body.table, Buffer.from(body.csv));
      return json(200, await sourceSummary(app.db, sourceId));
    },
  });

  app.publicRoute({
    method: 'POST',
    path: '/api/grading/refresh-failure',
    body: 'json',
    handler: async (ctx) => {
      const body = ctx.object();
      const sourceId = await sourceIdOf(app, emptyIds(), body.source);
      const times = body.times;
      if (typeof times !== 'number' || !Number.isInteger(times) || times < 0) throw invalid({ times: 'invalid' });
      await forceFailures(app, sourceId, times);
      return json(200, { source: sourceId, times });
    },
  });

  app.publicRoute({
    method: 'POST',
    path: '/api/grading/exports',
    body: 'json',
    handler: (ctx) => {
      const paused = ctx.object().paused;
      if (typeof paused !== 'boolean') throw invalid({ paused: 'invalid' });
      app.flags.exportsPaused = paused;
      return json(200, { paused });
    },
  });
};
