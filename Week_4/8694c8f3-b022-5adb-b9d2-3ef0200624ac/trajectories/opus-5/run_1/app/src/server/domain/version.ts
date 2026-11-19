import type pg from 'pg';
import { ApiError, fieldError } from '../errors.js';
import type { Actor } from '../../shared/types.js';
import type { AuthUser } from '../access.js';
import type { SetRow } from './document.js';

export interface ApplyContext {
  client: pg.PoolClient;
  setId: string;
  user: AuthUser;
  setRow: SetRow;
  target: string;
  payload: Record<string, unknown>;
  baseVersion: number | null;
}

export interface Applied {
  version: number;
  summary: string;
  /** Layers whose lock leases the op freed. */
  freedLayers?: string[];
}

async function latestActor(client: pg.PoolClient, setId: string, target: string, ownerId: string): Promise<Actor> {
  const result = await client.query<Actor>(
    `select u.id as user_id, u.display_name
       from ops o join users u on u.id = o.actor_id
      where o.set_id = $1 and o.target = $2
      order by o.seq desc limit 1`,
    [setId, target],
  );
  const row = result.rows[0];
  if (row !== undefined) return row;
  const owner = await client.query<Actor>(`select id as user_id, display_name from users where id = $1`, [
    ownerId,
  ]);
  const ownerRow = owner.rows[0];
  return ownerRow ?? { user_id: ownerId, display_name: 'Owner' };
}

/** The stale-version check, decided in one place. */
export async function checkBaseVersion(
  ctx: ApplyContext,
  currentVersion: number,
  currentState: unknown,
): Promise<void> {
  const base = ctx.baseVersion;
  if (base === null) throw fieldError('base_version', 'Base version is required');
  if (base > currentVersion) throw fieldError('base_version', 'Base version is newer than the server');
  if (base === currentVersion) return;
  const changedBy = await latestActor(ctx.client, ctx.setId, ctx.target, ctx.setRow.owner_id);
  throw new ApiError(409, 'stale_version', 'Someone changed this first', {
    current_version: currentVersion,
    current: currentState,
    changed_by: changedBy,
  });
}

export async function bumpLayer(ctx: ApplyContext, layerId: string): Promise<number> {
  const result = await ctx.client.query<{ version: number }>(
    `update layers set version = version + 1 where id = $1 returning version`,
    [layerId],
  );
  return result.rows[0]?.version ?? 1;
}

export async function bumpSettings(ctx: ApplyContext): Promise<number> {
  const result = await ctx.client.query<{ settings_version: number }>(
    `update sets set settings_version = settings_version + 1 where id = $1 returning settings_version`,
    [ctx.setId],
  );
  return result.rows[0]?.settings_version ?? 1;
}

export async function bumpGraph(ctx: ApplyContext): Promise<number> {
  const result = await ctx.client.query<{ graph_version: number }>(
    `update sets set graph_version = graph_version + 1 where id = $1 returning graph_version`,
    [ctx.setId],
  );
  return result.rows[0]?.graph_version ?? 1;
}

export async function bumpScript(ctx: ApplyContext, scriptId: string): Promise<number> {
  const result = await ctx.client.query<{ version: number }>(
    `update scripts set version = version + 1 where id = $1 returning version`,
    [scriptId],
  );
  return result.rows[0]?.version ?? 1;
}
