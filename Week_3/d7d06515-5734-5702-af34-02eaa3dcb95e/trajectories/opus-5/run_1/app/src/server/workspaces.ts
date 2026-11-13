import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ColorName, Point } from '../shared/api';
import type { Units } from '../shared/format';
import { query, queryOn } from './db';
import type { WorkspaceRecord } from './clock';
import type { ObjectGeometry } from './model';
import type { ObjectType } from '../shared/api';

export type Preset = 'blank' | 'studio-plan';

interface SeedLayer {
  name: string;
  color: ColorName;
  linetype: string;
  on?: boolean;
  frozen?: boolean;
  locked?: boolean;
  current?: boolean;
}

interface SeedObject {
  handle: string;
  type: ObjectType;
  layer: string;
  data: ObjectGeometry;
}

const BLANK_LAYERS: SeedLayer[] = [{ name: '0', color: 'White', linetype: 'Continuous', current: true }];

const STUDIO_PLAN_LAYERS: SeedLayer[] = [
  { name: '0', color: 'White', linetype: 'Continuous', current: true },
  { name: 'A-WALL', color: 'Yellow', linetype: 'Continuous' },
  { name: 'A-DOOR', color: 'Cyan', linetype: 'Continuous' },
  { name: 'A-ANNO', color: 'Green', linetype: 'Continuous' },
  { name: 'S-GRID', color: 'Red', linetype: 'Center', locked: true },
  { name: 'A-FURN', color: 'Magenta', linetype: 'Dashed', frozen: true },
];

function line(start: Point, end: Point): ObjectGeometry {
  return { start, end };
}

const STUDIO_PLAN_OBJECTS: SeedObject[] = [
  { handle: '1A', type: 'line', layer: 'A-WALL', data: line([0, 0], [6000, 0]) },
  { handle: '1B', type: 'line', layer: 'A-WALL', data: line([6000, 0], [6000, 4200]) },
  { handle: '1C', type: 'line', layer: 'A-WALL', data: line([6000, 4200], [0, 4200]) },
  { handle: '1D', type: 'line', layer: 'A-WALL', data: line([0, 4200], [0, 0]) },
  { handle: '3A', type: 'line', layer: 'A-WALL', data: line([0, 2400], [2400, 2400]) },
  { handle: '2A', type: 'line', layer: 'S-GRID', data: line([3000, -600], [3000, 4800]) },
  { handle: '2B', type: 'circle', layer: 'A-FURN', data: { center: [4500, 2100], radius: 450 } },
];

const WALL_DETAIL_LAYERS: SeedLayer[] = [
  { name: '0', color: 'White', linetype: 'Continuous', current: true },
  { name: 'A-WALL', color: 'Yellow', linetype: 'Continuous' },
  { name: 'A-ANNO', color: 'Green', linetype: 'Continuous' },
];

const WALL_DETAIL_OBJECTS: SeedObject[] = [
  {
    handle: '10',
    type: 'polyline',
    layer: 'A-WALL',
    data: {
      vertices: [
        [0, 0],
        [1200, 0],
        [1200, 300],
        [0, 300],
      ],
      closed: true,
    },
  },
  {
    handle: '11',
    type: 'mtext',
    layer: 'A-ANNO',
    data: { position: [0, 500], width: 1200, height: 100, contents: 'WALL TYPE W1' },
  },
];

function nextHandleAfter(objects: SeedObject[]): number {
  const highest = objects.reduce((max, object) => Math.max(max, Number.parseInt(object.handle, 16)), 0x0f);
  return highest + 1;
}

async function insertLayers(client: PoolClient, drawingId: string, layers: SeedLayer[]): Promise<void> {
  for (const [index, layer] of layers.entries()) {
    await client.query(
      `insert into layers (drawing_id, name, color, linetype, lineweight, is_on, frozen, locked, is_current, ord)
       values ($1,$2,$3,$4,'0.25 mm',$5,$6,$7,$8,$9)`,
      [
        drawingId,
        layer.name,
        layer.color,
        layer.linetype,
        layer.on ?? true,
        layer.frozen ?? false,
        layer.locked ?? false,
        layer.current ?? false,
        index,
      ],
    );
  }
}

async function insertObjects(client: PoolClient, drawingId: string, objects: SeedObject[]): Promise<void> {
  for (const [index, object] of objects.entries()) {
    await client.query(
      `insert into objects (drawing_id, handle, type, layer, color, linetype, linetype_scale, lineweight,
        dimension_style, text_style, multileader_style, data, ord)
       values ($1,$2,$3,$4,'ByLayer','ByLayer',1,'ByLayer','Standard','Standard','Standard',$5,$6)`,
      [drawingId, object.handle, object.type, object.layer, JSON.stringify(object.data), index + 1],
    );
  }
  await client.query('update drawings set next_handle = $2, object_seq = $3 where id = $1', [
    drawingId,
    nextHandleAfter(objects),
    objects.length,
  ]);
}

export async function insertLayouts(client: PoolClient, drawingId: string): Promise<void> {
  const layouts: Array<[string, string | null]> = [
    ['Model', null],
    ['Layout1', '1:50'],
    ['Layout2', '1:50'],
  ];
  for (const [index, [name, scale]] of layouts.entries()) {
    await client.query('insert into layouts (drawing_id, name, viewport_scale, ord) values ($1,$2,$3,$4)', [
      drawingId,
      name,
      scale,
      index,
    ]);
  }
}

export interface CreateDrawingOptions {
  workspaceId: string;
  folderId: string;
  name: string;
  units: Units;
  ownerUserId: string | null;
  isSample?: boolean;
  now: Date;
}

export async function insertDrawing(client: PoolClient, options: CreateDrawingOptions): Promise<string> {
  const id = crypto.randomUUID();
  await client.query(
    `insert into drawings (id, workspace_id, folder_id, name, units, plot_style, version, owner_user_id,
       is_sample, modified_at, created_at)
     values ($1,$2,$3,$4,$5,'Monochrome',1,$6,$7,$8,$8)`,
    [
      id,
      options.workspaceId,
      options.folderId,
      options.name,
      options.units,
      options.ownerUserId,
      options.isSample ?? false,
      options.now,
    ],
  );
  await insertLayouts(client, id);
  return id;
}

export async function applyPreset(client: PoolClient, drawingId: string, preset: Preset): Promise<void> {
  if (preset === 'blank') {
    await insertLayers(client, drawingId, BLANK_LAYERS);
    await insertObjects(client, drawingId, []);
    return;
  }
  await insertLayers(client, drawingId, STUDIO_PLAN_LAYERS);
  await insertObjects(client, drawingId, STUDIO_PLAN_OBJECTS);
}

export interface WorkspaceSeed {
  workspace: WorkspaceRecord;
  rootFolderId: string;
  samplesFolderId: string;
}

export async function createWorkspace(
  client: PoolClient,
  timeZone: string,
  units: Units,
  now: Date,
  creationDate: string,
): Promise<WorkspaceSeed> {
  const workspaceId = crypto.randomUUID();
  const created = await queryOn<WorkspaceRecord>(client, 
    'insert into workspaces (id, time_zone, units, created_at) values ($1,$2,$3,$4) returning *',
    [workspaceId, timeZone, units, now],
  );
  const workspace = created[0]!;

  const rootFolderId = crypto.randomUUID();
  await client.query(
    `insert into folders (id, workspace_id, parent_id, name, kind, modified_at, created_at)
     values ($1,$2,null,'My Drawings','root',$3,$3)`,
    [rootFolderId, workspaceId, now],
  );
  const samplesFolderId = crypto.randomUUID();
  await client.query(
    `insert into folders (id, workspace_id, parent_id, name, kind, modified_at, created_at)
     values ($1,$2,null,'Sample Files','samples',$3,$3)`,
    [samplesFolderId, workspaceId, now],
  );

  const studioSample = await insertDrawing(client, {
    workspaceId,
    folderId: samplesFolderId,
    name: 'Studio Plan Sample.dxf',
    units,
    ownerUserId: null,
    isSample: true,
    now,
  });
  await applyPreset(client, studioSample, 'studio-plan');

  const detailSample = await insertDrawing(client, {
    workspaceId,
    folderId: samplesFolderId,
    name: 'Wall Detail Sample.dxf',
    units,
    ownerUserId: null,
    isSample: true,
    now,
  });
  await insertLayers(client, detailSample, WALL_DETAIL_LAYERS);
  await insertObjects(client, detailSample, WALL_DETAIL_OBJECTS);

  await client.query(
    `insert into title_block_revisions (workspace_id, letter, footer_note, effective_date, created_at)
     values ($1,'A','Issued for coordination.',$2,$3)`,
    [workspaceId, creationDate, now],
  );

  return { workspace, rootFolderId, samplesFolderId };
}

export async function rootFolderId(workspaceId: string): Promise<string> {
  const rows = await query<{ id: string }>(
    "select id from folders where workspace_id = $1 and kind = 'root' limit 1",
    [workspaceId],
  );
  return rows[0]!.id;
}

export async function samplesFolderId(workspaceId: string): Promise<string> {
  const rows = await query<{ id: string }>(
    "select id from folders where workspace_id = $1 and kind = 'samples' limit 1",
    [workspaceId],
  );
  return rows[0]!.id;
}

/** New Drawing names default to `Drawing<n>.dxf` with the smallest free number. */
export async function nextDrawingName(folderId: string): Promise<string> {
  const rows = await query<{ name: string }>('select name from drawings where folder_id = $1', [folderId]);
  const taken = new Set(rows.map((row) => row.name.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const candidate = `Drawing${n}.dxf`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export async function replaceDrawingContent(
  client: PoolClient,
  drawingId: string,
  units: Units,
  layers: Array<{
    name: string;
    color: ColorName;
    linetype: string;
    on: boolean;
    frozen: boolean;
    locked: boolean;
  }>,
  objects: Array<{ type: ObjectType; layer: string; data: ObjectGeometry }>,
): Promise<void> {
  await client.query('delete from objects where drawing_id = $1', [drawingId]);
  await client.query('delete from layers where drawing_id = $1', [drawingId]);
  const seedLayers: SeedLayer[] = layers.map((layer, index) => ({
    name: layer.name,
    color: layer.color,
    linetype: layer.linetype,
    on: layer.on,
    frozen: layer.frozen,
    locked: layer.locked,
    current: index === 0,
  }));
  await insertLayers(client, drawingId, seedLayers);
  const seedObjects: SeedObject[] = objects.map((object, index) => ({
    handle: (0x10 + index).toString(16).toUpperCase(),
    type: object.type,
    layer: object.layer,
    data: object.data,
  }));
  await insertObjects(client, drawingId, seedObjects);
  await client.query('update drawings set units = $2 where id = $1', [drawingId, units]);
}
