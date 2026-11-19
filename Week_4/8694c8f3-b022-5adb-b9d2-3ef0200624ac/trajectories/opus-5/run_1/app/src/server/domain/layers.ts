import type pg from 'pg';
import type { LayerKind } from '../../shared/domain.js';
import { defaultBuses, defaultMaterial, defaultProps } from '../../shared/defaults.js';
import type { Vec3 } from '../../shared/types.js';


export interface NewLayer {
  id: string;
  setId: string;
  parentId: string | null;
  index: number;
  name: string;
  kind: LayerKind;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  props?: Record<string, number>;
  shaderVersion?: number | null;
}

export async function insertLayer(client: pg.PoolClient, layer: NewLayer): Promise<void> {
  await client.query(
    `insert into layers (id, set_id, parent_id, idx, name, kind, version, visible, position, rotation, scale,
                         props, material, model_asset_id, output_buses, shader_version)
     values ($1, $2, $3, $4, $5, $6, 1, true, $7, $8, $9, $10, $11, null, $12, $13)`,
    [
      layer.id,
      layer.setId,
      layer.parentId,
      layer.index,
      layer.name,
      layer.kind,
      layer.position ?? [0, 0, 0],
      layer.rotation ?? [0, 0, 0],
      layer.scale ?? [1, 1, 1],
      JSON.stringify({ ...defaultProps(layer.kind), ...(layer.props ?? {}) }),
      JSON.stringify(defaultMaterial(layer.kind)),
      defaultBuses(layer.kind),
      layer.shaderVersion ?? null,
    ],
  );
}

export async function siblingCount(
  client: pg.PoolClient,
  setId: string,
  parentId: string | null,
  excludeId: string | null,
): Promise<number> {
  const result = await client.query<{ count: number }>(
    `select count(*)::int as count from layers
      where set_id = $1 and parent_id is not distinct from $2 and ($3::uuid is null or id <> $3)`,
    [setId, parentId, excludeId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Siblings at or after the insertion point move up by one. */
export async function openGap(
  client: pg.PoolClient,
  setId: string,
  parentId: string | null,
  index: number,
): Promise<void> {
  await client.query(
    `update layers set idx = idx + 1
      where set_id = $1 and parent_id is not distinct from $2 and idx >= $3`,
    [setId, parentId, index],
  );
}

/** Siblings left behind close the gap, so indexes stay 0 to n-1. */
export async function closeGap(
  client: pg.PoolClient,
  setId: string,
  parentId: string | null,
  index: number,
): Promise<void> {
  await client.query(
    `update layers set idx = idx - 1
      where set_id = $1 and parent_id is not distinct from $2 and idx > $3`,
    [setId, parentId, index],
  );
}

export async function descendantIds(client: pg.PoolClient, setId: string, layerId: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `with recursive tree as (
        select id from layers where set_id = $1 and id = $2
        union all
        select l.id from layers l join tree t on l.parent_id = t.id
     )
     select id from tree where id <> $2`,
    [setId, layerId],
  );
  return result.rows.map((row) => row.id);
}
