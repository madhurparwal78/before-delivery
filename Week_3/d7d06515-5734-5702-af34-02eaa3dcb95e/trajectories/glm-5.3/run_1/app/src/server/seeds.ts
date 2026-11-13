import { db } from "./db.js";
import { randomToken } from "./config.js";
import { studioDateKey } from "./clock.js";
import { hashPassword, validateTimeZone } from "./accounts.js";
import { blockLibrary } from "../shared/types.js";

export interface SeededGeometry {
  handle: string;
  layer: string;
  type: string;
  geometry: Record<string, unknown>;
}

export interface StudioPlanSeed {
  layers: Array<{
    name: string;
    color: string;
    linetype: string;
    state: { on: boolean; frozen: boolean; locked: boolean; current: boolean };
  }>;
  objects: SeededGeometry[];
}

export function studioPlanSeed(): StudioPlanSeed {
  return {
    layers: [
      { name: "0", color: "White", linetype: "Continuous", state: { on: true, frozen: false, locked: false, current: true } },
      { name: "A-WALL", color: "Yellow", linetype: "Continuous", state: { on: true, frozen: false, locked: false, current: false } },
      { name: "A-DOOR", color: "Cyan", linetype: "Continuous", state: { on: true, frozen: false, locked: false, current: false } },
      { name: "A-ANNO", color: "Green", linetype: "Continuous", state: { on: true, frozen: false, locked: false, current: false } },
      { name: "S-GRID", color: "Red", linetype: "Center", state: { on: true, frozen: false, locked: true, current: false } },
      { name: "A-FURN", color: "Magenta", linetype: "Dashed", state: { on: true, frozen: true, locked: false, current: false } },
    ],
    objects: [
      { handle: "1A", layer: "A-WALL", type: "line", geometry: { start: [0, 0], end: [6000, 0] } },
      { handle: "1B", layer: "A-WALL", type: "line", geometry: { start: [6000, 0], end: [6000, 4200] } },
      { handle: "1C", layer: "A-WALL", type: "line", geometry: { start: [6000, 4200], end: [0, 4200] } },
      { handle: "1D", layer: "A-WALL", type: "line", geometry: { start: [0, 4200], end: [0, 0] } },
      { handle: "3A", layer: "A-WALL", type: "line", geometry: { start: [0, 2400], end: [2400, 2400] } },
      { handle: "2A", layer: "S-GRID", type: "line", geometry: { start: [3000, -600], end: [3000, 4800] } },
      { handle: "2B", layer: "A-FURN", type: "circle", geometry: { center: [4500, 2100], radius: 450 } },
    ],
  };
}

export interface SeedContext {
  workspaceId: string;
  folderId: string;
  drawingId: string;
  drawingName: string;
  now: number;
}

export async function seedBlocks(workspaceId: string): Promise<void> {
  for (const block of blockLibrary) {
    await db.run(`insert into blocks (workspace_id, name, definition) values ($1, $2, $3) on conflict do nothing`, [
      workspaceId,
      block.name,
      JSON.stringify(block),
    ]);
  }
}

export async function seedLayersAndObjects(
  drawingId: string,
  seed: StudioPlanSeed,
  now: number,
): Promise<void> {
  let position = 0;
  for (const layer of seed.layers) {
    await db.run(
      `insert into layers (drawing_id, name, name_lower, color, linetype, lineweight, is_on, frozen, locked, current, position)
       values ($1, $2, $3, $4, $5, '0.25 mm', $6, $7, $8, $9, $10)`,
      [
        drawingId,
        layer.name,
        layer.name.toLowerCase(),
        layer.color,
        layer.linetype,
        layer.state.on,
        layer.state.frozen,
        layer.state.locked,
        layer.state.current,
        position++,
      ],
    );
  }
  for (const obj of seed.objects) {
    await db.run(
      `insert into objects (handle, drawing_id, layer, type, color, linetype, linetype_scale, lineweight, dimension_style, text_style, multileader_style, geometry, created_epoch)
       values ($1, $2, $3, $4, 'ByLayer', 'ByLayer', 1, 'ByLayer', 'Standard', 'Standard', 'Standard', $5, $6)`,
      [obj.handle, drawingId, obj.layer, obj.type, JSON.stringify(obj.geometry), now],
    );
  }
}

export async function seedBlankDrawing(drawingId: string, now: number): Promise<void> {
  await db.run(
    `insert into layers (drawing_id, name, name_lower, color, linetype, lineweight, is_on, frozen, locked, current, position)
     values ($1, '0', '0', 'White', 'Continuous', '0.25 mm', true, false, false, true, 0)`,
    [drawingId],
  );
}

export async function seedLayouts(drawingId: string): Promise<void> {
  await db.run(
    `insert into layouts (drawing_id, name, viewport_scale, position) values ($1, 'Model', null, 0), ($1, 'Layout1', '1:50', 1), ($1, 'Layout2', '1:50', 2)`,
    [drawingId],
  );
}

export async function seedTitleBlock(workspaceId: string, now: number, zone: string): Promise<void> {
  const dateKey = studioDateKey(now, zone);
  await db.run(
    `insert into title_block_revisions (workspace_id, letter, footer_note, effective_date, position)
     values ($1, 'A', 'Issued for coordination.', $2, 0)
     on conflict (workspace_id, letter) do nothing`,
    [workspaceId, dateKey],
  );
}

export interface GradingWorkspace {
  workspaceId: string;
  drafterEmail: string;
  drafterPassword: string;
  reviewerEmail: string;
  drawingId: string;
  drawingName: string;
  drawingUrl: string;
  version: number;
}

export async function createGradingWorkspace(
  preset: "blank" | "studio-plan",
  zone: string,
  units: "mm" | "m",
): Promise<GradingWorkspace> {
  validateTimeZone(zone);
  const now = Date.now();
  const workspaceId = randomToken(9);
  const suffix = randomToken(6);
  const drafterEmail = `${suffix}@corbel-grading.test`;
  const reviewerEmail = `${suffix}r@corbel-grading.test`;
  const password = randomToken(12);
  const folderId = randomToken(9);
  const drawingId = randomToken(9);
  await db.tx(async (client) => {
    await client.query(`insert into workspaces (id, kind, time_zone, created_epoch) values ($1, 'grading', $2, $3)`, [
      workspaceId,
      zone,
      now,
    ]);
    await client.query(
      `insert into accounts (id, workspace_id, name, email, email_lower, password_hash, verified, confirmed_date_key, time_zone, created_epoch)
       values ($1, $2, 'Ines Halloran', $3, $3, $4, true, $5, $6, $7)`,
      [
        randomToken(9),
        workspaceId,
        drafterEmail,
        hashPassword(password),
        studioDateKey(now, zone),
        zone,
        now,
      ],
    );
    await client.query(
      `insert into folders (id, workspace_id, parent_id, name, name_lower, modified_epoch, created_epoch)
       values ($1, $2, null, 'My Drawings', 'my drawings', $3, $3)`,
      [folderId, workspaceId, now],
    );
    await client.query(
      `insert into drawings (id, workspace_id, folder_id, name, name_lower, units, plot_style, version, next_handle, max_handle_used, modified_epoch, created_epoch)
       values ($1, $2, $3, 'Plan A.dxf', 'plan a.dxf', $4, 'Monochrome', 1, $5, 6, $6, $6)`,
      [drawingId, workspaceId, folderId, units, preset === "studio-plan" ? "3B" : "10", now],
    );
  });
  if (preset === "studio-plan") {
    await seedLayersAndObjects(drawingId, studioPlanSeed(), now);
  } else {
    await seedBlankDrawing(drawingId, now);
  }
  await seedLayouts(drawingId);
  await seedTitleBlock(workspaceId, now, zone);
  await seedBlocks(workspaceId);
  return {
    workspaceId,
    drafterEmail,
    drafterPassword: password,
    reviewerEmail,
    drawingId,
    drawingName: "Plan A.dxf",
    drawingUrl: `/d/${drawingId}`,
    version: 1,
  };
}

export async function seedSampleFiles(): Promise<void> {
  const existing = await db.one<{ id: string }>(`select id from workspaces where kind = 'sample' limit 1`);
  if (existing) return;
  const now = Date.now();
  const workspaceId = randomToken(9);
  await db.tx(async (client) => {
    await client.query(`insert into workspaces (id, kind, time_zone, created_epoch, sample) values ($1, 'sample', 'UTC', $2, true)`, [
      workspaceId,
      now,
    ]);
    const studioDrawingId = randomToken(9);
    const wallDrawingId = randomToken(9);
    const folderId = randomToken(9);
    await client.query(
      `insert into folders (id, workspace_id, parent_id, name, name_lower, modified_epoch, created_epoch)
       values ($1, $2, null, 'Sample Files', 'sample files', $3, $3)`,
      [folderId, workspaceId, now],
    );
    await client.query(
      `insert into drawings (id, workspace_id, folder_id, name, name_lower, units, plot_style, version, next_handle, max_handle_used, modified_epoch, created_epoch, sample)
       values ($1, $2, $3, 'Studio Plan Sample.dxf', 'studio plan sample.dxf', 'mm', 'Monochrome', 1, $4, 6, $5, $5, true)`,
      [studioDrawingId, workspaceId, folderId, "3B", now],
    );
    await client.query(
      `insert into drawings (id, workspace_id, folder_id, name, name_lower, units, plot_style, version, next_handle, max_handle_used, modified_epoch, created_epoch, sample)
       values ($1, $2, $3, 'Wall Detail Sample.dxf', 'wall detail sample.dxf', 'mm', 'Monochrome', 1, '11', 2, $4, $4, true)`,
      [wallDrawingId, workspaceId, folderId, now],
    );
  });
  const studio = studioPlanSeed();
  const studioDrawingId = (
    await db.one<{ id: string }>(`select id from drawings where sample = true and name = 'Studio Plan Sample.dxf'`)
  )?.id;
  if (studioDrawingId) await seedLayersAndObjects(studioDrawingId, studio, now);
  const wallDrawingId = (
    await db.one<{ id: string }>(`select id from drawings where sample = true and name = 'Wall Detail Sample.dxf'`)
  )?.id;
  if (wallDrawingId) {
    await db.run(
      `insert into layers (drawing_id, name, name_lower, color, linetype, lineweight, is_on, frozen, locked, current, position)
       values ($1, '0', '0', 'White', 'Continuous', '0.25 mm', true, false, false, true, 0),
              ($1, 'A-WALL', 'a-wall', 'Yellow', 'Continuous', '0.25 mm', true, false, false, false, 1),
              ($1, 'A-ANNO', 'a-anno', 'Green', 'Continuous', '0.25 mm', true, false, false, false, 2)`,
      [wallDrawingId],
    );
    await db.run(
      `insert into objects (handle, drawing_id, layer, type, color, linetype, linetype_scale, lineweight, dimension_style, text_style, multileader_style, geometry, created_epoch)
       values ('10', $1, 'A-WALL', 'polyline', 'ByLayer', 'ByLayer', 1, 'ByLayer', 'Standard', 'Standard', 'Standard', $2, $3),
              ('11', $1, 'A-ANNO', 'mtext', 'ByLayer', 'ByLayer', 1, 'ByLayer', 'Standard', 'Standard', 'Standard', $4, $3)`,
      [
        wallDrawingId,
        JSON.stringify({ vertices: [[0, 0], [1200, 0], [1200, 300], [0, 300]], closed: true }),
        now,
        JSON.stringify({ position: [0, 500], width: 1000, height: 100, contents: "WALL TYPE W1" }),
      ],
    );
  }
  if (studioDrawingId) await seedLayouts(studioDrawingId);
  if (wallDrawingId) await seedLayouts(wallDrawingId);
}
