import { pool } from '../db.js';
import { Err } from '../errors.js';
import type { Ctx, Reply } from '../http.js';
import { requireMembership } from '../access.js';
import { readLayer } from '../domain/document.js';
import type { ShaderVersionSummary } from '../../shared/types.js';

export async function listShaderVersions(ctx: Ctx): Promise<Reply> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  const layerId = ctx.params['layerId'] ?? '';
  if ((await readLayer(pool, membership.setId, layerId)) === null) throw Err.notFound();
  const result = await pool.query<{
    number: number;
    sha256: string;
    size: number;
    user_id: string;
    display_name: string;
    created_at: Date;
    restored_from: number | null;
  }>(
    `select v.number, v.sha256, v.size, u.id as user_id, u.display_name, v.created_at, v.restored_from
       from shader_versions v join users u on u.id = v.author_id
      where v.layer_id = $1 order by v.number desc`,
    [layerId],
  );
  const versions: ShaderVersionSummary[] = result.rows.map((row) => ({
    number: row.number,
    sha256: row.sha256,
    size: row.size,
    author: { user_id: row.user_id, display_name: row.display_name },
    created_at: row.created_at.toISOString(),
    restored_from: row.restored_from,
  }));
  return { status: 200, json: { versions } };
}

export async function getShaderVersion(ctx: Ctx): Promise<Reply> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  const layerId = ctx.params['layerId'] ?? '';
  const number = Number(ctx.params['n'] ?? '');
  if (!Number.isInteger(number)) throw Err.notFound();
  const result = await pool.query<{ number: number; source: string; sha256: string }>(
    `select number, source, sha256 from shader_versions where set_id = $1 and layer_id = $2 and number = $3`,
    [membership.setId, layerId, number],
  );
  const row = result.rows[0];
  if (row === undefined) throw Err.notFound();
  return { status: 200, json: row };
}
