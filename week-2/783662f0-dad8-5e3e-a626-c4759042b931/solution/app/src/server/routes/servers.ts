import { Router } from 'express';
import { config } from '../config.js';
import { lockKey, one, query, tx, withLock } from '../db/pool.js';
import { fail } from '../errors.js';
import { requireIfMatch, setEtag } from '../http/conditional.js';
import { idempotencyKey, remember, replayed } from '../http/idempotency.js';
import { requireUser } from '../http/session.js';
import { FIELD_COPY, already_member, memberLimit } from '../../shared/copy.js';
import { PLAN_IDS } from '../../shared/domain.js';
import { createWorld } from '../db/seed.js';
import {
  approve,
  billingObject,
  publishServer,
  refresh,
  requestPlanChange,
  statementCsv,
  statementFilename,
} from '../domain/billing.js';
import { appendEvent } from '../domain/events.js';
import { entriesForServer } from '../domain/ledger.js';
import { leaderboard } from '../domain/leaderboards.js';
import {
  type ServerRow,
  loadServerById,
  planOf,
  requireOwner,
  scopeBySlug,
  serverEtag,
  serverObject,
} from '../domain/servers.js';
import { BillingUnreachable } from '../services/killbill.js';
import * as kb from '../services/killbill.js';
import { attemptMail, link, queueMail } from '../services/mail.js';
import { buildExport, readExport } from '../domain/exports.js';
import { instant, newId, newToken, slugify, zoneLabel } from '../util.js';
import {
  FieldErrors,
  checkChoice,
  checkEmail,
  checkHandle,
  checkServerName,
  checkTimeZone,
  onlyFields,
} from '../validate.js';
import { friendsOf, publishFriends } from './session.js';
import { body, created, ok, queryString, route } from './helpers.js';

export const serverRoutes = Router();

/* Checkout. */

serverRoutes.post(
  '/checkout',
  route(async (req, res) => {
    const user = await requireUser(req);
    onlyFields(body(req), ['server_name', 'plan']);
    const key = idempotencyKey(req);
    /* Requests with one user and key run one at a time across instances, so a parallel duplicate waits, finds the first request's stored response and replays it: one server and one Kill Bill account per key. */
    await withLock(lockKey(`idempotency:${user.id}:checkout:${key}`), async () => {
      const stored = await replayed(user.id, 'checkout', key, body(req));
      if (stored !== null) {
        res.status(stored.status).type('application/json; charset=utf-8').send(
          JSON.stringify(stored.body),
        );
        return;
      }

      const errors = new FieldErrors();
      const name = checkServerName(errors, body(req).server_name);
      const plan = checkChoice(errors, 'plan', body(req).plan, PLAN_IDS, FIELD_COPY.planRequired);
      errors.throwIfAny();
      if (plan === null) throw fail('validation', { fields: { plan: FIELD_COPY.planRequired } });

      /* The name check and the insert run one at a time per name across instances, so two checkouts racing for one name give one server and one server_name field error. */
      const { server, slug } = await withLock(lockKey(`server-name:${slugify(name)}`), async () => {
        const slug = slugify(name);
        const clash = await one<{ id: string }>(
          'SELECT id FROM servers WHERE lower(name) = lower($1) OR slug = $2',
          [name, slug],
        );
        if (clash !== null) {
          throw fail('validation', { fields: { server_name: FIELD_COPY.serverNameTaken } });
        }

        /* The server is created only after Kill Bill holds its account, tag and
           subscription. A retry with the same key reuses any account it made. */
        const serverId = newId();
        let accountId: string;
        try {
          accountId = await kb.ensureAccount(`plotwright-${serverId}`, name);
          await kb.ensureAutoPayOff(accountId);
          await kb.ensureSubscription(accountId, `plotwright-${serverId}-plan`, plan);
        } catch (error) {
          if (error instanceof BillingUnreachable) throw fail('billing_unavailable');
          throw error;
        }

        await tx(async (client) => {
          await client.query(
            `INSERT INTO servers (id, slug, name, owner_id, plan, status, time_zone,
                                  weather_seed, kb_account_id)
             VALUES ($1, $2, $3, $4, $5, 'pending_approval', 'UTC', $6, $7)`,
            [serverId, slug, name, user.id, plan, Math.floor(Math.random() * 4), accountId],
          );
          await client.query(
            `INSERT INTO members (server_id, user_id, role) VALUES ($1, $2, 'owner')`,
            [serverId, user.id],
          );
          await createWorld(client, serverId, 'home', 'Home');
        });

        return { server: await loadServerById(serverId), slug };
      });
      if (server === null) throw fail('internal');
      const payload = {
        server: await serverObject(server, user.id),
        billing: await billingObject(server),
        billing_url: `/s/${slug}/billing`,
      };
      await remember(user.id, 'checkout', key, body(req), 201, payload);
      created(res, payload);
    });
  }),
);

/* The server record. */

serverRoutes.get(
  '/servers/:slug',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    const server = await evaluateClock(scope.server);
    setEtag(res, serverEtag(server));
    ok(res, await serverObject(server, user.id));
  }),
);

serverRoutes.patch(
  '/servers/:slug',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    onlyFields(body(req), ['time_zone']);
    requireIfMatch(req, serverEtag(scope.server));
    const errors = new FieldErrors();
    const timeZone = checkTimeZone(errors, body(req).time_zone);
    errors.throwIfAny();

    const rows = await query<ServerRow>(
      'UPDATE servers SET time_zone = $2, revision = revision + 1 WHERE id = $1 RETURNING *',
      [scope.server.id, timeZone],
    );
    const updated = rows[0];
    await publishServer(updated);
    setEtag(res, serverEtag(updated));
    ok(res, await serverObject(updated, user.id));
  }),
);

/** Every request evaluates the grace window on the server's own clock. */
async function evaluateClock(server: ServerRow): Promise<ServerRow> {
  if (
    server.status !== 'past_due' ||
    server.suspends_at === null ||
    Date.now() < server.suspends_at.getTime()
  ) {
    return server;
  }
  return refresh(server);
}

/* Members. */

serverRoutes.post(
  '/servers/:slug/members',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    onlyFields(body(req), ['handle']);

    const errors = new FieldErrors();
    const handle = checkHandle(errors, 'handle', body(req).handle);
    errors.throwIfAny();

    const account = await one<{ id: string; handle: string; display_name: string }>(
      'SELECT id, handle, display_name FROM users WHERE handle = $1',
      [handle],
    );
    if (account === null) throw fail('unknown_handle');

    const already = await one<{ user_id: string }>(
      'SELECT user_id FROM members WHERE server_id = $1 AND user_id = $2',
      [scope.server.id, account.id],
    );
    if (already !== null) {
      throw fail('already_member', { message: already_member(handle) });
    }

    const limit = planOf(scope.server).members;
    const count = await one<{ count: string }>(
      'SELECT count(*) AS count FROM members WHERE server_id = $1',
      [scope.server.id],
    );
    if (Number(count?.count ?? 0) >= limit) {
      throw fail('member_limit_reached', { message: memberLimit(limit) });
    }

    await query(`INSERT INTO members (server_id, user_id, role) VALUES ($1, $2, 'member')`, [
      scope.server.id,
      account.id,
    ]);
    await publishFriends(scope.server.id);
    await publishServer(scope.server);
    created(res, {
      member: { handle: account.handle, display_name: account.display_name, role: 'member' },
    });
  }),
);

serverRoutes.get(
  '/servers/:slug/friends',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    ok(res, { friends: await friendsOf(scope.server.id) });
  }),
);

/* Invites. */

interface InviteRecord {
  id: string;
  email: string;
  state: 'pending' | 'used' | 'expired' | 'superseded';
  expires_at: Date;
  mail_state: 'held' | 'sent' | null;
}

const inviteObject = (row: InviteRecord) => ({
  id: row.id,
  email: row.email,
  state: row.state,
  mail: row.mail_state === 'sent' ? ('sent' as const) : ('held' as const),
  expires_at: instant(row.expires_at),
});

const INVITE_QUERY = `
  SELECT i.id, i.email, i.state, i.expires_at,
         (SELECT m.state FROM mail m WHERE m.dedupe_key = 'invite:' || i.id) AS mail_state
    FROM invites i`;

serverRoutes.post(
  '/servers/:slug/invites',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    onlyFields(body(req), ['email']);
    const key = idempotencyKey(req);
    /* Requests with one user and key run one at a time across instances, so a parallel duplicate
       waits, finds the first request's stored response and replays it: one record per key. */
    await withLock(lockKey(`idempotency:${user.id}:invites:${key}`), async () => {
      const stored = await replayed(user.id, 'invites', key, body(req));
      if (stored !== null) {
        res
          .status(stored.status)
          .type('application/json; charset=utf-8')
          .send(JSON.stringify(stored.body));
        return;
      }

      const errors = new FieldErrors();
      const email = checkEmail(errors, 'email', body(req).email);
      errors.throwIfAny();

      const member = await one<{ id: string }>(
        `SELECT u.id FROM members m JOIN users u ON u.id = m.user_id
          WHERE m.server_id = $1 AND lower(u.email) = lower($2)`,
        [scope.server.id, email],
      );
      if (member !== null) throw fail('already_member');

      /* A new invite supersedes every earlier pending invite for that email. */
      const inviteId = await tx(async (client) => {
        await client.query(
          `UPDATE invites SET state = 'superseded'
            WHERE server_id = $1 AND lower(email) = lower($2) AND state = 'pending'`,
          [scope.server.id, email],
        );
        const id = newId();
        await client.query(
          `INSERT INTO invites (id, server_id, inviter_id, email, token, state, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', now() + ($6 || ' seconds')::interval)`,
          [id, scope.server.id, user.id, email, newToken(), String(config().inviteTtlSeconds)],
        );
        return id;
      });

      const invite = await one<InviteRecord & { token: string }>(
        `SELECT i.id, i.token, i.email, i.state, i.expires_at, NULL AS mail_state
           FROM invites i WHERE i.id = $1`,
        [inviteId],
      );
      if (invite === null) throw fail('internal');

      const expiry = zoneLabel(invite.expires_at, scope.server.time_zone);
      const mailId = await queueMail({
        serverId: scope.server.id,
        kind: 'invite',
        toHandle: email,
        toEmail: email,
        subject: `${user.displayName} invited you to ${scope.server.name}`,
        lines: [
          `${user.displayName} invited you to play on ${scope.server.name} in Plotwright.`,
          `Join with this one-time link: ${link(`/join/${invite.token}`)}`,
          `The link works once and expires at ${expiry}.`,
        ],
        dedupeKey: `invite:${inviteId}`,
      });
      if (mailId !== null) await attemptMail(mailId);

      const fresh = await one<InviteRecord>(`${INVITE_QUERY} WHERE i.id = $1`, [inviteId]);
      const payload = { invite: inviteObject(fresh ?? invite) };
      await remember(user.id, 'invites', key, body(req), 201, payload);
      await appendEvent({
        serverId: scope.server.id,
        stream: 'server',
        scopeId: scope.server.id,
        kind: 'invite',
        payload: payload.invite,
        audience: [user.id],
      });
      created(res, payload);
    });
  }),
);

serverRoutes.get(
  '/servers/:slug/invites',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    await query(
      `UPDATE invites SET state = 'expired'
        WHERE server_id = $1 AND state = 'pending' AND expires_at <= now()`,
      [scope.server.id],
    );
    const rows = await query<InviteRecord>(
      `${INVITE_QUERY} WHERE i.server_id = $1 AND i.inviter_id = $2 ORDER BY i.created_at DESC`,
      [scope.server.id, user.id],
    );
    ok(res, { invites: rows.map(inviteObject) });
  }),
);

/* Mail. */

serverRoutes.get(
  '/servers/:slug/mail',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    const rows = await query<{
      id: string;
      kind: string;
      to_handle: string;
      subject: string;
      state: 'held' | 'sent';
      created_at: Date;
      sent_at: Date | null;
    }>(
      `SELECT id, kind, to_handle, subject, state, created_at, sent_at
         FROM mail WHERE server_id = $1 ORDER BY created_at DESC`,
      [scope.server.id],
    );
    ok(res, {
      mail: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        to_handle: row.to_handle,
        subject: row.subject,
        state: row.state,
        created_at: instant(row.created_at),
        sent_at: row.sent_at === null ? null : instant(row.sent_at),
      })),
    });
  }),
);

/* Billing. */

serverRoutes.get(
  '/servers/:slug/billing',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    const server = await refresh(scope.server);
    ok(res, await billingObject(server));
  }),
);

serverRoutes.post(
  '/servers/:slug/billing/payments',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    onlyFields(body(req), []);

    /* Approvals for one server are serialised by a lock that holds across
       instances, so that Kill Bill records exactly one payment per invoice. */
    const answer = await withLock(
      lockKey(`approve:${scope.server.id}`),
      async () => {
        try {
          const outcome = await approve(scope.server);
          return {
            status: outcome.kind === 'pending' ? 202 : 200,
            billing: await billingObject(outcome.server),
          };
        } catch (error) {
          if (error instanceof BillingUnreachable) throw fail('billing_unavailable');
          throw error;
        }
      },
    );
    res
      .status(answer.status)
      .type('application/json; charset=utf-8')
      .send(JSON.stringify(answer.billing));
  }),
);

serverRoutes.post(
  '/servers/:slug/plan',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    onlyFields(body(req), ['plan']);
    const errors = new FieldErrors();
    const plan = checkChoice(errors, 'plan', body(req).plan, PLAN_IDS, FIELD_COPY.planRequired);
    errors.throwIfAny();
    if (plan === null) throw fail('validation', { fields: { plan: FIELD_COPY.planRequired } });
    try {
      const updated = await requestPlanChange(scope.server, plan);
      ok(res, await billingObject(updated));
    } catch (error) {
      if (error instanceof BillingUnreachable) throw fail('billing_unavailable');
      throw error;
    }
  }),
);

serverRoutes.get(
  '/servers/:slug/billing/statement.csv',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    let csv: string;
    try {
      csv = await statementCsv(scope.server);
    } catch (error) {
      if (error instanceof BillingUnreachable) throw fail('billing_unavailable');
      throw error;
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${statementFilename(scope.server.slug)}"`,
    );
    res.send(csv);
  }),
);

serverRoutes.get(
  '/servers/:slug/ledger',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    ok(res, { entries: await entriesForServer(scope.server.id) });
  }),
);

/* Exports, allowed in every status. */

serverRoutes.post(
  '/servers/:slug/exports',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    onlyFields(body(req), []);
    const record = await buildExport(scope.server);
    created(res, {
      export: {
        id: record.id,
        key: record.key,
        download_url: `/api/servers/${scope.server.slug}/exports/${record.id}`,
      },
    });
  }),
);

serverRoutes.get(
  '/servers/:slug/exports/:id',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    const archive = await readExport(scope.server, req.params.id);
    res.status(200);
    res.setHeader('Content-Type', 'application/x-tar');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${scope.server.slug}-worlds.tar"`,
    );
    res.send(archive);
  }),
);

/* Leaderboards and seasons. */

serverRoutes.get(
  '/servers/:slug/leaderboards/:game',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    const game = req.params.game;
    if (game !== 'chess' && game !== 'four' && game !== 'tricks') throw fail('not_found');
    ok(res, {
      game,
      season: scope.server.season,
      entries: await leaderboard(scope.server.id, game, scope.server.season),
    });
  }),
);

serverRoutes.post(
  '/servers/:slug/seasons',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    onlyFields(body(req), []);
    const rows = await query<{ season: number }>(
      'UPDATE servers SET season = season + 1, revision = revision + 1 WHERE id = $1 RETURNING season',
      [scope.server.id],
    );
    const season = rows[0]?.season ?? scope.server.season;
    const updated = await loadServerById(scope.server.id);
    if (updated !== null) await publishServer(updated);
    for (const game of ['chess', 'four', 'tricks'] as const) {
      await appendEvent({
        serverId: scope.server.id,
        stream: 'server',
        scopeId: scope.server.id,
        kind: 'leaderboard',
        payload: { game, season, entries: [] },
      });
    }
    created(res, { season });
  }),
);

/* Characters search, scoped to the one server. */

serverRoutes.get(
  '/servers/:slug/characters',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    const prefix = (queryString(req, 'q') ?? '').trim().toLowerCase();
    const mine = queryString(req, 'mine') === 'true';
    const { characterObject } = await import('../domain/characters.js');
    const rows = await query<Parameters<typeof characterObject>[0]>(
      `SELECT * FROM characters
        WHERE server_id = $1
          AND ($2 = '' OR lower(name) LIKE $2 || '%')
          AND ($3 = false OR user_id = $4)
        ORDER BY name`,
      [scope.server.id, prefix, mine, user.id],
    );
    const characters = [];
    for (const row of rows.slice(0, 10)) characters.push(await characterObject(row));
    ok(res, { characters, total: rows.length });
  }),
);
