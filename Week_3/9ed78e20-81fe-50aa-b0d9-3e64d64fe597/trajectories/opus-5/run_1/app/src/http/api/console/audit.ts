import { pool } from '../../../db/pool.js';
import { verifyChain, type AuditEntry } from '../../../domain/audit.js';
import { ApiError } from '../../errors.js';
import { jsonReply } from '../../reply.js';
import { route } from '../../server.js';
import { consoleRead, consoleWrite, requireRole } from './guard.js';

type StoredEntry = Omit<AuditEntry, 'at'> & { at: Date };

function entryObject(row: StoredEntry): Record<string, unknown> {
  return {
    seq: row.seq,
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    detail: row.detail,
    prev_hash: row.prev_hash,
    hash: row.hash,
  };
}

const COLUMNS = `seq, id, at, actor, action, target_type, target_id, detail, prev_hash, hash`;

export function registerConsoleAuditApi(): void {
  route('GET', '/api/console/audit', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      requireRole(session, 'administrator');
      const rawLimit = ctx.url.searchParams.get('limit');
      const parsedLimit = rawLimit === null ? 100 : Number.parseInt(rawLimit, 10);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(500, Math.max(1, parsedLimit))
        : 100;
      const beforeRaw = ctx.url.searchParams.get('before_seq');
      const beforeSeq = beforeRaw === null ? null : Number.parseInt(beforeRaw, 10);
      const result = await pool.query<StoredEntry>(
        `SELECT ${COLUMNS} FROM audit_entries
          WHERE ($1::text IS NULL OR action = $1::text)
            AND ($2::text IS NULL OR target_id = $2::text)
            AND ($3::bigint IS NULL OR seq < $3::bigint)
          ORDER BY seq DESC
          LIMIT $4`,
        [
          ctx.url.searchParams.get('action'),
          ctx.url.searchParams.get('target_id'),
          beforeSeq !== null && Number.isFinite(beforeSeq) ? beforeSeq : null,
          limit,
        ],
      );
      return jsonReply(200, { entries: result.rows.map(entryObject) });
    }),
  );

  route('GET', '/api/console/audit/verify', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      requireRole(session, 'administrator');
      const result = await pool.query<StoredEntry>(
        `SELECT ${COLUMNS} FROM audit_entries ORDER BY seq`,
      );
      const report = verifyChain(
        result.rows.map((row) => ({ ...row, at: row.at.toISOString() })),
      );
      return jsonReply(200, report);
    }),
  );

  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    route(method, '/api/console/audit/:id', 'console_writes', async (ctx) =>
      consoleWrite(ctx, async () => {
        throw new ApiError(
          405,
          'audit_immutable',
          'Audit entries cannot be changed or removed.',
        );
      }),
    );
  }
}
