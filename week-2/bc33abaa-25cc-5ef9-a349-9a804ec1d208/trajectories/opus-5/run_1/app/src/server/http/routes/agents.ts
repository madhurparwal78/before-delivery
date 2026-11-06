import { Express } from 'express';
import { AGENT_TOKEN_LIMITS } from '../../../shared/plans';
import { query } from '../../db/pool';
import { releaseAllLocksOf } from '../../domain/scenes';
import {
  AGENT_TOKEN_MAX_SECONDS,
  AGENT_TOKEN_MIN_SECONDS,
  toIso,
  tokenWarningAt,
  withinWindow,
} from '../../domain/time';
import { writeAudit } from '../../domain/workspace';
import { agentSecret, randomId, sha256Hex } from '../../util/crypto';
import { fail } from '../errors';
import {
  body,
  param,
  parseIsoTime,
  requireCaller,
  requirePermission,
  requireString,
  requireWritableWorkspace,
} from '../context';
import { route } from '../route';

interface TokenRow {
  id: string;
  workspace_id: string;
  name: string;
  scope: 'read' | 'edit';
  expires_at: Date;
  revoked_at: Date | null;
  issued_by_id: string;
  issued_by_name: string;
}

function tokenStatus(row: TokenRow): 'active' | 'expired' | 'revoked' {
  if (row.revoked_at !== null) return 'revoked';
  return row.expires_at.getTime() <= Date.now() ? 'expired' : 'active';
}

function tokenDto(row: TokenRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    expiresAt: toIso(row.expires_at),
    status: tokenStatus(row),
    issuedBy: { kind: 'member', id: row.issued_by_id, name: row.issued_by_name },
  };
}

export function registerAgentRoutes(app: Express): void {
  app.get(
    '/api/agent-tokens',
    route(async (req, res) => {
      const context = await requireCaller(req);
      requirePermission(context, 'member.manage');
      const rows = await query<TokenRow>(
        `SELECT * FROM agent_tokens WHERE workspace_id = $1 ORDER BY created_at DESC`,
        [context.workspace.id],
      );
      res.json({ tokens: rows.map(tokenDto) });
    }),
  );

  app.post(
    '/api/agent-tokens',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      requirePermission(context, 'member.manage');
      requireWritableWorkspace(context);
      const name = requireString(input, 'name', { min: 1, max: 60 });
      const scopeRaw = input.scope;
      if (scopeRaw !== 'read' && scopeRaw !== 'edit') {
        throw fail.validation({ scope: 'Must be read or edit' });
      }
      const expiresAt = parseIsoTime(input.expiresAt, 'expiresAt');
      if (!withinWindow(expiresAt, AGENT_TOKEN_MIN_SECONDS, AGENT_TOKEN_MAX_SECONDS, new Date())) {
        throw fail.validation({
          expiresAt: 'Must be between 10 seconds and 365 days from now',
        });
      }
      const [counted] = await query<{ active: string }>(
        `SELECT count(*) AS active FROM agent_tokens
         WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [context.workspace.id],
      );
      const limit = AGENT_TOKEN_LIMITS[context.subscription.plan];
      if (Number(counted?.active ?? 0) >= limit) throw fail.conflict('token_limit_reached');

      const secret = agentSecret();
      const rows = await query<TokenRow>(
        `INSERT INTO agent_tokens (id, workspace_id, name, scope, secret_sha256, expires_at,
                                   warn_at, issued_by_id, issued_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          randomId('tok'),
          context.workspace.id,
          name,
          scopeRaw,
          sha256Hex(secret),
          expiresAt,
          tokenWarningAt(expiresAt),
          context.author.id,
          context.author.name,
        ],
      );
      const row = rows[0] as TokenRow;
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'token.issued',
        target: { type: 'agent_token', id: row.id },
      });
      res.status(201).json({ ...tokenDto(row), token: secret });
    }),
  );

  app.delete(
    '/api/agent-tokens/:tokenId',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const rows = await query<TokenRow>(
        `SELECT * FROM agent_tokens WHERE id = $1 AND workspace_id = $2`,
        [param(req, 'tokenId'), context.workspace.id],
      );
      const token = rows[0];
      if (!token) throw fail.notFound();
      requirePermission(context, 'member.manage');
      const status = tokenStatus(token);
      if (status !== 'active') {
        throw fail.conflict('invalid_transition', { from: status, to: 'revoked' });
      }
      await query(`UPDATE agent_tokens SET revoked_at = now() WHERE id = $1`, [token.id]);
      await releaseAllLocksOf(context.workspace.id, token.id);
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'token.revoked',
        target: { type: 'agent_token', id: token.id },
      });
      res.status(204).end();
    }),
  );
}
