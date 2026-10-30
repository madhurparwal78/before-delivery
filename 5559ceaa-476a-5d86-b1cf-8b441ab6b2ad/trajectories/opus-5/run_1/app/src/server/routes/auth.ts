import { randomBytes, randomUUID } from 'node:crypto';
import type { User } from '../../shared/api.js';
import { config } from '../config.js';
import { pool, tx, type Queryable } from '../db.js';
import { hasPassed, signInTokenExpiry } from '../domain/expiry.js';
import { landingPath } from '../domain/landing.js';
import {
  forbidden,
  linkExpired,
  linkNotFound,
  linkUsed,
  mailUnavailable,
  storageUnavailable,
  validation,
} from '../http/errors.js';
import type { Route } from '../http/router.js';
import { emailField, textField } from '../http/validate.js';
import { createSampleWorkspace, uploadSampleCheckpoints } from '../seed.js';
import {
  clearedSessionCookie,
  endAuthSession,
  sessionCookie,
  startAuthSession,
} from '../services/authSession.js';
import { eraseLearner } from '../services/erasure.js';
import { deliver } from '../services/smtp.js';
import { StorageUnreachable } from '../services/storage.js';

function newSignInToken(): string {
  return randomBytes(32).toString('base64url');
}

export function verifyUrl(token: string): string {
  return `${config.publicUrl}/auth/verify?token=${token}`;
}

export async function issueSignInToken(
  client: Queryable,
  input: { email: string; inviteName?: string; projectId?: string },
): Promise<string> {
  const token = newSignInToken();
  const issuedAt = new Date();
  await client.query(
    `insert into signin_tokens (token, email, invite_name, project_id, expires_at, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      token,
      input.email,
      input.inviteName ?? null,
      input.projectId ?? null,
      signInTokenExpiry(issuedAt),
      issuedAt,
    ],
  );
  return token;
}

async function memberProjectIds(client: Queryable, userId: string): Promise<string[]> {
  const { rows } = await client.query<{ project_id: string }>(
    'select project_id from memberships where user_id = $1 order by seq',
    [userId],
  );
  return rows.map((row) => row.project_id);
}

interface TokenRow {
  token: string;
  email: string;
  project_id: string | null;
  expires_at: Date;
  used_at: Date | null;
}

export const authRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/auth/magic-link',
    scope: 'public',
    body: 'json',
    handler: async (ctx) => {
      const email = emailField(ctx.fields(), 'email');
      const token = await issueSignInToken(pool, { email });
      try {
        await deliver({
          to: email,
          subject: 'Your Relay Bench sign-in link',
          body: `Open this link to sign in to Relay Bench.\n\n${verifyUrl(token)}\n\nThe link works once.\n`,
        });
      } catch {
        await pool.query('delete from signin_tokens where token = $1', [token]);
        throw mailUnavailable();
      }
      return { status: 202, payload: { status: 'accepted' } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/verify',
    scope: 'public',
    body: 'json',
    handler: async (ctx) => {
      const token = textField(ctx.fields(), 'token', 'Send the token from your email.');
      const outcome = await tx(async (client) => {
        const { rows } = await client.query<TokenRow>(
          `select token, email, project_id, expires_at, used_at
             from signin_tokens where token = $1 for update`,
          [token],
        );
        const row = rows[0];
        if (row === undefined) throw linkNotFound();
        if (row.used_at !== null) throw linkUsed();
        if (hasPassed(row.expires_at, new Date())) throw linkExpired();
        await client.query('update signin_tokens set used_at = now() where token = $1', [token]);

        const found = await client.query<User>(
          'select id, email, name, kind from users where email = $1',
          [row.email],
        );
        let user = found.rows[0];
        let sampleCheckpointIds: string[] = [];
        if (user === undefined) {
          const id = randomUUID();
          const name = row.email.split('@')[0] ?? row.email;
          await client.query(
            `insert into users (id, email, name, kind) values ($1, $2, $3, 'mentor')`,
            [id, row.email, name],
          );
          user = { id, email: row.email, name, kind: 'mentor' };
          const sample = await createSampleWorkspace(client, { id, name }, new Date());
          sampleCheckpointIds = sample.checkpointIds;
        }

        const cookie = await startAuthSession(client, user.id);
        const landing = landingPath({
          invitedProjectId: row.project_id,
          memberProjectIds: await memberProjectIds(client, user.id),
        });
        return { user, cookie, landing, sampleCheckpointIds };
      });

      await uploadSampleCheckpoints(outcome.sampleCheckpointIds);
      return {
        status: 200,
        payload: { user: outcome.user, landing: outcome.landing },
        headers: { 'set-cookie': sessionCookie(outcome.cookie) },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/sign-out',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      await endAuthSession(ctx.req);
      return { status: 204, headers: { 'set-cookie': clearedSessionCookie() } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/me',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => ({ status: 200, payload: { user: ctx.user } }),
  },
  {
    method: 'DELETE',
    pattern: '/api/me',
    scope: 'auth',
    body: 'json',
    handler: async (ctx) => {
      if (ctx.user.kind !== 'learner') {
        throw forbidden('Only learner accounts can erase themselves.');
      }
      const confirm = ctx.fields()['confirm'];
      if (confirm !== 'ERASE') throw validation({ confirm: 'Type ERASE to confirm.' });
      try {
        await eraseLearner(ctx.user);
      } catch (cause) {
        if (cause instanceof StorageUnreachable) throw storageUnavailable();
        throw cause;
      }
      return { status: 204, headers: { 'set-cookie': clearedSessionCookie() } };
    },
  },
];
