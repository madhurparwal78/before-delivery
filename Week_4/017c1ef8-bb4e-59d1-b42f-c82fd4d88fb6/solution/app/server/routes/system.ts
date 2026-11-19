import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { attach } from '../live.js';
import { memberOf } from '../auth.js';
import { moveClock, now } from '../clock.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { isJobAdmin } from '../domain/company-admins.js';
import { notFound, validation } from '../errors.js';
import { storageReachable } from '../storage.js';

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({ status: (await storageReachable()) ? 'ok' : 'unavailable' }));

  app.get('/api/config', async () => ({
    post_max_chars: config.postMaxChars,
    see_more_chars: config.seeMoreChars,
    typing_timeout_ms: config.typingTimeoutMs,
    max_skills: config.maxSkills,
    photo_max_bytes: config.photoMaxBytes,
    resume_max_bytes: config.resumeMaxBytes,
    feed_page_size: config.feedPageSize,
    time_zone: config.timeZone,
    now: now().toISOString(),
  }));

  app.post('/api/grading/clock', async (request) => {
    requireGradingKey(request.headers['x-grading-key']);
    const body = request.body as { now?: unknown };
    const target = typeof body.now === 'string' ? new Date(body.now) : null;
    if (!target || Number.isNaN(target.getTime())) throw validation({ now: 'Send an ISO 8601 instant.' });
    return { now: (await moveClock(pool, target)).toISOString() };
  });
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
const sameSecret = (given: string, expected: string): boolean => timingSafeEqual(digest(given), digest(expected));

/** Every grading route answers 404 without the configured key. */
export function requireGradingKey(header: string | string[] | undefined): void {
  if (!config.gradingKey || typeof header !== 'string' || !sameSecret(header, config.gradingKey)) throw notFound();
}

export async function liveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/live', async (request, reply) => {
    const member = memberOf(request);
    const requested = (request.query as { editor?: string }).editor;
    const editorJobId = typeof requested === 'string' && requested !== '' && (await isJobAdmin(pool, member.id, requested)) ? requested : null;
    reply.hijack();
    attach(member.id, editorJobId, reply.raw);
  });
}
