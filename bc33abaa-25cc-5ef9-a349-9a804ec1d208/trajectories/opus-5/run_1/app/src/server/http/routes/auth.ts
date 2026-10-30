import { Express } from 'express';
import { MemberDto } from '../../../shared/api';
import { query, transaction } from '../../db/pool';
import { TRIAL_SEATS } from '../../../shared/plans';
import { hashPassword, randomId, urlSafeToken, sha256Hex, verifyPassword } from '../../util/crypto';
import { trialEndFrom, toIso } from '../../domain/time';
import {
  MemberRow,
  seatsPurchased,
  seatsUsed,
  subscriptionDto,
  writeAudit,
} from '../../domain/workspace';
import { fail } from '../errors';
import {
  body,
  clearSessionCookie,
  requireCaller,
  requirePermission,
  requireString,
  setSessionCookie,
} from '../context';
import { route } from '../route';

export function memberDto(member: MemberRow): MemberDto {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    joinedAt: toIso(member.joined_at),
  };
}

function validTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw fail.validation({ timeZone: 'Must be an IANA time zone name' });
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw fail.validation({ timeZone: 'Must be an IANA time zone name' });
  }
  return value;
}

function validEmail(body: Record<string, unknown>, field = 'email'): string {
  const value = body[field];
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 200) {
    throw fail.validation({ [field]: 'Must be an email address' });
  }
  return value;
}

export async function createSession(memberId: string, workspaceId: string): Promise<string> {
  const token = urlSafeToken(32);
  await query(
    `INSERT INTO sessions (token_sha256, member_id, workspace_id) VALUES ($1, $2, $3)`,
    [sha256Hex(token), memberId, workspaceId],
  );
  return token;
}

export function registerAuthRoutes(app: Express): void {
  app.post(
    '/api/signup',
    route(async (req, res) => {
      const input = body(req);
      const workspaceName = requireString(input, 'workspaceName', { min: 1, max: 80 });
      const name = requireString(input, 'name', { min: 1, max: 80 });
      const email = validEmail(input);
      const password = requireString(input, 'password', {
        min: 10,
        max: 200,
        message: 'Must be at least 10 characters',
      });
      const timeZone = validTimeZone(input.timeZone);

      const taken = await query<{ id: string }>(
        `SELECT id FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL`,
        [email],
      );
      if (taken.length > 0) throw fail.conflict('email_taken');

      const workspaceId = randomId('ws');
      const memberId = randomId('mem');
      const outcome = await transaction(async (client) => {
        const workspace = await client.query<{ id: string; name: string; time_zone: string; created_at: Date }>(
          `INSERT INTO workspaces (id, name, time_zone, review_links_enabled, signing_secret)
           VALUES ($1, $2, $3, true, $4)
           RETURNING id, name, time_zone, created_at`,
          [workspaceId, workspaceName, timeZone, `whsec_${urlSafeToken(16)}`],
        );
        const row = workspace.rows[0];
        if (!row) throw new Error('workspace insert failed');
        const member = await client.query<MemberRow>(
          `INSERT INTO members (id, workspace_id, name, email, role, password_hash)
           VALUES ($1, $2, $3, $4, 'owner', $5)
           RETURNING *`,
          [memberId, workspaceId, name, email, hashPassword(password)],
        );
        await client.query(
          `INSERT INTO subscriptions (workspace_id, state, plan, period, extra_seats, trial_ends_at)
           VALUES ($1, 'trial', 'team', 'monthly', 0, $2)`,
          [workspaceId, trialEndFrom(row.created_at)],
        );
        await writeAudit(
          {
            workspaceId,
            actor: { kind: 'member', id: memberId, name },
            action: 'workspace.created',
            target: { type: 'workspace', id: workspaceId },
          },
          client,
        );
        return { workspace: row, member: member.rows[0] as MemberRow };
      });

      const token = await createSession(memberId, workspaceId);
      setSessionCookie(res, token);
      res.status(201).json({
        workspace: {
          id: outcome.workspace.id,
          name: outcome.workspace.name,
          timeZone: outcome.workspace.time_zone,
        },
        member: memberDto(outcome.member),
        subscription: {
          state: 'trial',
          plan: 'team',
          period: 'monthly',
          seatsPurchased: TRIAL_SEATS,
          extraSeats: 0,
          trialEndsAt: toIso(trialEndFrom(outcome.workspace.created_at)),
          graceEndsAt: null,
          pendingChange: null,
        },
      });
    }),
  );

  app.post(
    '/api/auth/login',
    route(async (req, res) => {
      const input = body(req);
      const email = typeof input.email === 'string' ? input.email : '';
      const password = typeof input.password === 'string' ? input.password : '';
      const rows = await query<MemberRow & { workspace_name: string; time_zone: string }>(
        `SELECT m.*, w.name AS workspace_name, w.time_zone
         FROM members m JOIN workspaces w ON w.id = m.workspace_id
         WHERE lower(m.email) = lower($1) AND m.removed_at IS NULL`,
        [email],
      );
      const member = rows[0];
      if (!member || !verifyPassword(password, member.password_hash)) {
        throw fail.invalidCredentials();
      }
      const token = await createSession(member.id, member.workspace_id);
      setSessionCookie(res, token);
      res.json({
        member: memberDto(member),
        workspace: {
          id: member.workspace_id,
          name: member.workspace_name,
          timeZone: member.time_zone,
        },
      });
    }),
  );

  app.post(
    '/api/auth/logout',
    route(async (req, res) => {
      const context = await requireCaller(req);
      if (context.caller.kind === 'member') {
        const cookie = req.headers.cookie ?? '';
        const match = /orrery_session=([^;]+)/.exec(cookie);
        if (match) {
          await query(`UPDATE sessions SET revoked_at = now() WHERE token_sha256 = $1`, [
            sha256Hex(decodeURIComponent(match[1] as string)),
          ]);
        }
      }
      clearSessionCookie(res);
      res.status(204).end();
    }),
  );

  app.get(
    '/api/me',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const workspace = {
        id: context.workspace.id,
        name: context.workspace.name,
        timeZone: context.workspace.time_zone,
      };
      if (context.caller.kind === 'agent') {
        res.json({
          agent: {
            id: context.caller.tokenId,
            name: context.caller.name,
            scope: context.caller.scope,
          },
          workspace,
        });
        return;
      }
      const rows = await query<MemberRow>(
        `SELECT * FROM members WHERE id = $1 AND removed_at IS NULL`,
        [context.caller.memberId],
      );
      const self = rows[0];
      if (!self) throw fail.unauthenticated();
      res.json({
        member: memberDto(self),
        workspace,
        subscription: subscriptionDto(context.subscription),
      });
    }),
  );

  app.get(
    '/api/workspace',
    route(async (req, res) => {
      const context = await requireCaller(req);
      res.json({
        id: context.workspace.id,
        name: context.workspace.name,
        timeZone: context.workspace.time_zone,
        reviewLinksEnabled: context.workspace.review_links_enabled,
      });
    }),
  );

  app.patch(
    '/api/workspace',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      requirePermission(context, 'workspace.admin');
      const patch: { name?: string; timeZone?: string; reviewLinksEnabled?: boolean } = {};
      if (input.name !== undefined) {
        patch.name = requireString(input, 'name', { min: 1, max: 80 });
      }
      if (input.timeZone !== undefined) patch.timeZone = validTimeZone(input.timeZone);
      if (input.reviewLinksEnabled !== undefined) {
        if (typeof input.reviewLinksEnabled !== 'boolean') {
          throw fail.validation({ reviewLinksEnabled: 'Must be true or false' });
        }
        patch.reviewLinksEnabled = input.reviewLinksEnabled;
      }
      const rows = await query<{
        id: string;
        name: string;
        time_zone: string;
        review_links_enabled: boolean;
      }>(
        `UPDATE workspaces
         SET name = COALESCE($2, name),
             time_zone = COALESCE($3, time_zone),
             review_links_enabled = COALESCE($4, review_links_enabled)
         WHERE id = $1
         RETURNING id, name, time_zone, review_links_enabled`,
        [
          context.workspace.id,
          patch.name ?? null,
          patch.timeZone ?? null,
          patch.reviewLinksEnabled ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw fail.notFound();
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'workspace.updated',
        target: { type: 'workspace', id: context.workspace.id },
      });
      res.json({
        id: row.id,
        name: row.name,
        timeZone: row.time_zone,
        reviewLinksEnabled: row.review_links_enabled,
      });
    }),
  );

  app.get(
    '/api/dashboard',
    route(async (req, res) => {
      const context = await requireCaller(req);
      requirePermission(context, 'workspace.read');
      const [sceneCounts] = await query<{ scenes: string; published: string; scheduled: string }>(
        `SELECT
           (SELECT count(*) FROM scenes WHERE workspace_id = $1) AS scenes,
           (SELECT count(DISTINCT scene_id) FROM versions WHERE workspace_id = $1 AND state = 'published') AS published,
           (SELECT count(*) FROM versions WHERE workspace_id = $1 AND state = 'scheduled') AS scheduled`,
        [context.workspace.id],
      );
      const [tokenCount] = await query<{ active: string }>(
        `SELECT count(*) AS active FROM agent_tokens
         WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [context.workspace.id],
      );
      res.json({
        seatsUsed: await seatsUsed(context.workspace.id),
        seatsPurchased: seatsPurchased(context.subscription),
        scenes: Number(sceneCounts?.scenes ?? 0),
        publishedScenes: Number(sceneCounts?.published ?? 0),
        scheduledVersions: Number(sceneCounts?.scheduled ?? 0),
        activeAgentTokens: Number(tokenCount?.active ?? 0),
        subscription: subscriptionDto(context.subscription),
      });
    }),
  );
}
