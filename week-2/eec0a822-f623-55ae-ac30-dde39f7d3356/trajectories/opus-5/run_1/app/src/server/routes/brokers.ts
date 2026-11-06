import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne, transaction } from '../db.js';
import {
  conflict,
  mailUnavailable,
  notFound,
  pageEnded,
  rateLimited,
  validation,
  yachtWithdrawn,
} from '../http/errors.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { actorInWorkspace, requireAction } from '../auth.js';
import { FIELD_ERRORS, formatInstant } from '../../shared/copy.js';
import { pageStatus, type PageRow } from '../domain/pages.js';
import { toInstantString } from '../../shared/zone.js';
import { availabilityWindow, type Season } from '../domain/weeks.js';
import { weeklyRateMinor } from '../domain/pricing.js';
import { effectiveStatus, placeHold, releaseHold, weekSummaries, type HoldRow } from '../domain/holds.js';
import { findYacht, listYachts, metres, yachtRates } from '../records.js';
import { MailUnreachable, sendMail } from '../services/mail.js';
import { json, today } from './helpers.js';
import { readClientName } from './holds.js';

const BROKER_HOLD_LIMIT = 5;

interface BrokerRow {
  readonly workspace_id: string;
  readonly id: string;
  readonly name: string;
  readonly contact_name: string;
  readonly email: string;
  readonly notes: string;
  readonly seed_order: number;
}

interface BrokerPageRow extends PageRow {
  readonly workspace_id: string;
  readonly broker_id: string;
}

async function latestPage(workspaceId: string, brokerId: string): Promise<BrokerPageRow | null> {
  return queryOne<BrokerPageRow>(
    `SELECT * FROM broker_pages WHERE workspace_id = $1 AND broker_id = $2
      ORDER BY issued_at DESC LIMIT 1`,
    [workspaceId, brokerId],
  );
}

async function listBrokers(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'brokers');
  const brokers = await query<BrokerRow>(
    'SELECT * FROM brokers WHERE workspace_id = $1 ORDER BY seed_order',
    [actor.workspaceId],
  );
  const result = [];
  for (const broker of brokers) {
    const page = await latestPage(actor.workspaceId, broker.id);
    result.push({
      id: broker.id,
      name: broker.name,
      contactName: broker.contact_name,
      email: broker.email,
      notes: broker.notes,
      page: {
        status: pageStatus(page, ctx.now),
        issuedAt: page === null ? null : toInstantString(page.issued_at),
        endsAt: page === null ? null : toInstantString(page.ends_at),
      },
    });
  }
  return json(200, { brokers: result });
}

async function requireBroker(workspaceId: string, brokerId: string): Promise<BrokerRow> {
  const broker = await queryOne<BrokerRow>(
    'SELECT * FROM brokers WHERE workspace_id = $1 AND id = $2',
    [workspaceId, brokerId],
  );
  if (broker === null) throw notFound();
  return broker;
}

async function issuePage(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const broker = await requireBroker(actor.workspaceId, ctx.params.brokerId);
  requireAction(actor, 'brokers');
  readJsonBody(ctx);
  const token = randomBytes(24).toString('base64url');
  const endsAt = new Date(ctx.now.getTime() + config.timers.brokerPageSeconds * 1000);
  try {
    await sendMail({
      to: broker.email,
      subject: `Your ${actor.workspaceName} broker page`,
      body: [
        `Dear ${broker.contact_name},`,
        '',
        `Here is your ${actor.workspaceName} availability page.`,
        `${config.appPublicUrl}/b/${token}`,
        '',
        `This link works until ${formatInstant(endsAt)}.`,
        '',
        'Tidewright',
      ].join('\n'),
    });
  } catch (error) {
    if (error instanceof MailUnreachable) throw mailUnavailable();
    throw error;
  }
  await transaction(async (client) => {
    await client.query(
      `UPDATE broker_pages SET ended_at = $3
        WHERE workspace_id = $1 AND broker_id = $2 AND ended_at IS NULL`,
      [actor.workspaceId, broker.id, ctx.now],
    );
    await client.query(
      `INSERT INTO broker_pages (id, workspace_id, broker_id, token, issued_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), actor.workspaceId, broker.id, token, ctx.now, endsAt],
    );
  });
  return json(201, {
    page: {
      status: 'live',
      issuedAt: toInstantString(ctx.now),
      endsAt: toInstantString(endsAt),
      path: `/b/${token}`,
    },
  });
}

async function endPage(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const broker = await requireBroker(actor.workspaceId, ctx.params.brokerId);
  requireAction(actor, 'brokers');
  const page = await latestPage(actor.workspaceId, broker.id);
  if (pageStatus(page, ctx.now) !== 'live') throw conflict('page_not_live');
  const live = page as BrokerPageRow;
  await query('UPDATE broker_pages SET ended_at = $2 WHERE id = $1', [live.id, ctx.now]);
  return json(200, {
    page: {
      status: 'ended',
      issuedAt: toInstantString(live.issued_at),
      endsAt: toInstantString(live.ends_at),
      path: `/b/${live.token}`,
    },
  });
}

interface BrokerTokenContext {
  readonly page: BrokerPageRow;
  readonly broker: BrokerRow;
  readonly workspaceName: string;
}

async function requireLiveBrokerPage(ctx: Ctx): Promise<BrokerTokenContext> {
  const found = await queryOne<
    BrokerPageRow & {
      broker_name: string;
      contact_name: string;
      broker_email: string;
      notes: string;
      workspace_name: string;
      seed_order: number;
    }
  >(
    `SELECT p.*, b.name AS broker_name, b.contact_name, b.email AS broker_email, b.notes,
            b.seed_order, w.name AS workspace_name
       FROM broker_pages p
       JOIN brokers b ON b.workspace_id = p.workspace_id AND b.id = p.broker_id
       JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.token = $1`,
    [ctx.params.token],
  );
  if (found === null) throw notFound();
  if (pageStatus(found, ctx.now) !== 'live') throw pageEnded();
  return {
    page: found,
    broker: {
      workspace_id: found.workspace_id,
      id: found.broker_id,
      name: found.broker_name,
      contact_name: found.contact_name,
      email: found.broker_email,
      notes: found.notes,
      seed_order: found.seed_order,
    },
    workspaceName: found.workspace_name,
  };
}

function brokerHoldJson(hold: HoldRow, yachtSlug: string, now: Date): Record<string, unknown> {
  const status = effectiveStatus(hold, now);
  return {
    id: hold.id,
    yachtSlug,
    weekStart: hold.week_start,
    clientName: hold.client_name,
    status,
    position: status === 'waiting' ? hold.position : null,
    lapsesAt:
      status === 'waiting' || hold.lapses_at === null ? null : toInstantString(hold.lapses_at),
  };
}

async function brokerHolds(
  workspaceId: string,
  brokerId: string,
  now: Date,
): Promise<Record<string, unknown>[]> {
  const holds = await query<HoldRow & { yacht_slug: string }>(
    `SELECT h.*, y.slug AS yacht_slug FROM holds h JOIN yachts y ON y.id = h.yacht_id
      WHERE h.workspace_id = $1 AND h.placed_by_broker_id = $2 ORDER BY h.placed_at DESC`,
    [workspaceId, brokerId],
  );
  return holds.map((hold) => brokerHoldJson(hold, hold.yacht_slug, now));
}

async function readBrokerPage(ctx: Ctx): Promise<Reply> {
  const context = await requireLiveBrokerPage(ctx);
  const weeks = availabilityWindow(today(ctx.now));
  const yachts = (await listYachts(context.page.workspace_id)).filter(
    (yacht) => yacht.status === 'on_sale',
  );
  const payload = [];
  for (const yacht of yachts) {
    const summaries = await weekSummaries(
      yacht.id,
      weeks,
      (season) => weeklyRateMinor(yachtRates(yacht), season as Season),
      yacht.currency,
      ctx.now,
    );
    payload.push({
      slug: yacht.slug,
      name: yacht.name,
      base: yacht.base,
      cabins: yacht.cabins,
      lengthM: metres(yacht.length_cm),
      weeks: summaries.map((week) => ({
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        status: week.status,
        weeklyRateMinor: week.weeklyRateMinor,
        currency: week.currency,
      })),
    });
  }
  return json(200, {
    broker: { name: context.broker.name },
    company: { name: context.workspaceName },
    status: 'live',
    endsAt: toInstantString(context.page.ends_at),
    yachts: payload,
    holds: await brokerHolds(context.page.workspace_id, context.broker.id, ctx.now),
  });
}

/** The broker hold rate limit, checked before the token, page state or body. */
async function countBrokerHoldRequest(token: string, now: Date): Promise<void> {
  const windowMs = config.timers.brokerRateWindowSeconds * 1000;
  const since = new Date(now.getTime() - windowMs);
  const recent = await query<{ requested_at: Date }>(
    'SELECT requested_at FROM broker_hold_requests WHERE token = $1 AND requested_at > $2 ORDER BY requested_at',
    [token, since],
  );
  if (recent.length >= BROKER_HOLD_LIMIT) {
    const oldest = recent[0].requested_at.getTime();
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now.getTime()) / 1000));
    throw rateLimited(retryAfter);
  }
  await query(
    'INSERT INTO broker_hold_requests (id, token, requested_at) VALUES ($1,$2,$3)',
    [randomUUID(), token, now],
  );
}

async function brokerPlaceHold(ctx: Ctx): Promise<Reply> {
  await countBrokerHoldRequest(ctx.params.token, ctx.now);
  const context = await requireLiveBrokerPage(ctx);
  const body = readJsonBody(ctx);
  const yachtSlug = typeof body.yachtSlug === 'string' ? body.yachtSlug.trim() : '';
  const yacht = await findYacht(context.page.workspace_id, yachtSlug);
  if (yacht === null) throw notFound();
  if (yacht.status === 'withdrawn') throw yachtWithdrawn();
  const weeks = availabilityWindow(today(ctx.now));
  const weekStart = typeof body.weekStart === 'string' ? body.weekStart.trim() : '';
  if (!weeks.includes(weekStart)) throw validation({ weekStart: FIELD_ERRORS.weekStart });
  const clientName = readClientName(body.clientName);
  const hold = await transaction((client) =>
    placeHold(
      client,
      {
        workspaceId: context.page.workspace_id,
        yachtId: yacht.id,
        weekStart,
        clientName,
        queue: body.queue === true,
        memberId: null,
        memberName: null,
        brokerId: context.broker.id,
        brokerName: context.broker.name,
      },
      ctx.now,
    ),
  );
  return json(201, { hold: brokerHoldJson(hold, yacht.slug, ctx.now) });
}

async function brokerReleaseHold(ctx: Ctx): Promise<Reply> {
  const context = await requireLiveBrokerPage(ctx);
  const hold = await queryOne<HoldRow & { yacht_slug: string }>(
    `SELECT h.*, y.slug AS yacht_slug FROM holds h JOIN yachts y ON y.id = h.yacht_id
      WHERE h.id = $1 AND h.workspace_id = $2 AND h.placed_by_broker_id = $3`,
    [ctx.params.holdId, context.page.workspace_id, context.broker.id],
  );
  if (hold === null) throw notFound();
  const released = await transaction((client) => releaseHold(client, hold, ctx.now));
  return json(200, { hold: brokerHoldJson(released, hold.yacht_slug, ctx.now) });
}

export function registerBrokerRoutes(router: Router): void {
  router.add('/api/w/:ws/brokers', { GET: listBrokers });
  router.add('/api/w/:ws/brokers/:brokerId/page', { POST: issuePage });
  router.add('/api/w/:ws/brokers/:brokerId/page/end', { POST: endPage });
  router.add('/api/broker/:token', { GET: readBrokerPage });
  router.add('/api/broker/:token/holds', { POST: brokerPlaceHold });
  router.add('/api/broker/:token/holds/:holdId/release', { POST: brokerReleaseHold });
}
