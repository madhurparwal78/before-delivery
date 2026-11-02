import type { Request, Response } from 'express';
import { ERR, asyncRoute } from '../errors';
import type { AppServices } from '../session';
import { checkChain, type ChainCheckResult } from '../audit';
import type { DbRow } from '../querier';

interface AuditDbRow extends DbRow {
  id: string;
  seq: number;
  at: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  before: unknown;
  after: unknown;
  prev_hash: string;
  hash: string;
}

/** GET /api/audit, GET /api/audit/chain, and the 405 write guard (DP-11, DP-12, DP-14). */
export function auditRoutes(svc: AppServices) {
  const listRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      if (req.sessionUser!.role !== 'Admin') throw ERR.forbidden();
      const fields: Record<string, string> = {};
      let limit = 100;
      if (req.query.limit !== undefined) {
        const n = Number(req.query.limit);
        if (!Number.isInteger(n) || n < 1 || n > 500 || String(n) !== String(req.query.limit).trim()) {
          fields.limit = 'Use a whole number from 1 to 500.';
        } else {
          limit = n;
        }
      }
      let beforeSeq: number | null = null;
      if (req.query.before_seq !== undefined) {
        const raw = String(req.query.before_seq).trim();
        const n = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 1) {
          fields.before_seq = 'Use a positive whole number.';
        } else {
          beforeSeq = n;
        }
      }
      if (Object.keys(fields).length > 0) throw ERR.validation(fields);
      const params: unknown[] = [];
      let sql = `SELECT id, seq, at, actor_id, actor_role, action, target_type, target_id, before, after, prev_hash, hash FROM audit_log`;
      if (beforeSeq !== null) {
        params.push(beforeSeq);
        sql += ` WHERE seq < $${params.length}`;
      }
      params.push(limit);
      sql += ` ORDER BY seq DESC LIMIT $${params.length}`;
      const rows = await svc.db.query<AuditDbRow>(sql, params as never[]);
      const totalRow = await svc.db.queryOne<{ n: string }>(`SELECT count(*) AS n FROM audit_log`);
      const users = await svc.db.query<{ id: string; name: string }>(`SELECT id, name FROM users`);
      const names = new Map(users.map((u) => [u.id, u.name]));
      const body = {
        rows: rows.map((r) => ({
          id: r.id,
          seq: Number(r.seq),
          at: r.at,
          actor: { id: r.actor_id, name: names.get(r.actor_id) ?? r.actor_id },
          actor_role: r.actor_role,
          action: r.action,
          target: { type: r.target_type, id: r.target_id },
          before: r.before ?? null,
          after: r.after ?? null,
          prev_hash: r.prev_hash,
          hash: r.hash,
        })),
        total: Number(totalRow?.n ?? 0),
        next_before_seq: rows.length === 0 ? null : Number(rows[rows.length - 1]!.seq) === 1 ? null : Number(rows[rows.length - 1]!.seq),
      };
      res.json(body);
    }),
  ];

  const chainRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      if (req.sessionUser!.role !== 'Admin') throw ERR.forbidden();
      const rows = await svc.db.query<AuditDbRow>(
        `SELECT seq, at, actor_id, actor_role, action, target_type, target_id, before, after, prev_hash, hash FROM audit_log ORDER BY seq ASC`
      );
      const result: ChainCheckResult = checkChain(
        rows.map((r) => ({
          seq: r.seq,
          at: r.at,
          actor_id: r.actor_id,
          actor_role: r.actor_role,
          action: r.action,
          target_type: r.target_type,
          target_id: r.target_id,
          before: r.before ?? null,
          after: r.after ?? null,
          prev_hash: r.prev_hash,
          hash: r.hash,
        }))
      );
      res.json(result);
    }),
  ];

  return { listRoute, chainRoute };
}

/** Writes on the audit log routes answer 405 for every role (DP-11). */
export function auditWriteGuard(_req: Request, res: Response): void {
  res.status(405).json({ error: { code: 'method_not_allowed', message: "This action isn't allowed." } });
}
