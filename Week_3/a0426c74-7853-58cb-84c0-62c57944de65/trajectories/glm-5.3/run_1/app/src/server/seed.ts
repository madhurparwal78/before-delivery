import { pool } from './db.js';
import { ApiError, ERROR_TEXT } from '../shared/errors.js';
import type { Entity, Pt } from '../shared/geometry.js';
import { createEmptyModel, type DrawingModel } from '../shared/model.js';
import { DrawingEngine, handleNumber } from './engine.js';
import { saveModel } from './ops.js';
import { publishVersion, sheetById, viewportsForSheet } from './sheets.js';
import type { Storage } from './storage.js';
import { randomId } from '../shared/num.js';

// ---------------------------------------------------------------------------
// Grading seed: builds a whole world in one call, through the normal paths.
// ---------------------------------------------------------------------------

interface SeedRequest {
  users?: Array<{ username: string; password: string }>;
  folders?: Array<{ key: string; name: string; parent: string | null; roles?: Record<string, string> }>;
  drawings?: Array<SeedDrawing>;
}

interface SeedDrawing {
  key: string;
  folder: string;
  name: string;
  layers?: Array<{ name: string; colour: string; linetype: string; lineweight: number; on: boolean; frozen: boolean; locked: boolean }>;
  entities?: Array<Entity & { handle: string }>;
  generate?: { lines: number; spacing: number };
  blocks?: Array<{ name: string; base: Pt; entities: Entity[]; attributes: Array<{ tag: string; default: string }> }>;
  dim_styles?: Array<{ name: string; precision: number; prefix: string; suffix: string; scale: number; text_height_mm: number }>;
  parameters?: Array<{ name: string; expression: string }>;
  constraints?: Array<{ kind: string; refs: Array<{ handle: string; point: string | null }>; expression: string | null }>;
  xrefs?: Array<{ name: string; source: string; x: number; y: number; scale: number; rotation: number; clip: unknown }>;
  layer_states?: Array<{ name: string }>;
  sheets?: Array<SeedSheet>;
}

interface SeedSheet {
  key: string;
  name: string;
  size: 'A3' | 'A4';
  locked: boolean;
  attributes: Record<string, string>;
  viewports?: Array<{ x: number; y: number; width: number; height: number; scale: string; view_x: number; view_y: number; frozen_layers: string[] }>;
  publish?: number;
  markups?: Array<Record<string, unknown>>;
  issues?: Array<Record<string, unknown>>;
  rfis?: Array<Record<string, unknown>>;
  reviews?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
}

export interface SeedOutcome {
  users: string[];
  folders: Record<string, string>;
  drawings: Record<string, string>;
  sheets: Record<string, string>;
  versions: Record<string, string>;
  issues: Record<string, string>;
  rfis: Record<string, string>;
  links: Record<string, string>;
}

export async function runSeed(request: SeedRequest, config: { storage: Storage; now: Date; linkTtlMs: number; reviewTtlMs: number }): Promise<SeedOutcome> {
  const users = request.users ?? [];
  const created: string[] = [];
  for (const user of users) {
    const existing = await pool.query<{ username: string }>('SELECT username FROM users WHERE username = $1', [user.username]);
    if (existing.rows[0]) {
      created.push(user.username);
      continue;
    }
    const { hashPassword } = await import('./auth.js');
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [user.username, hashPassword(user.password)]);
    created.push(user.username);
  }
  const folderIds: Record<string, string> = {};
  for (const folder of request.folders ?? []) {
    const id = randomId('f');
    await pool.query('INSERT INTO folders (id, name, parent_id, created_by) VALUES ($1, $2, $3, $4)', [
      id,
      folder.name,
      folder.parent ? folderIds[folder.parent] ?? null : null,
      created[0] ?? 'seed',
    ]);
    folderIds[folder.key] = id;
    for (const [username, role] of Object.entries(folder.roles ?? {})) {
      await pool.query('INSERT INTO folder_roles (folder_id, username, role) VALUES ($1, $2, $3) ON CONFLICT (folder_id, username) DO UPDATE SET role = $3', [id, username, role]);
    }
  }
  const drawingIds: Record<string, string> = {};
  const sheetIds: Record<string, string> = {};
  const versionIds: Record<string, string> = {};
  const issueIds: Record<string, string> = {};
  const rfiIds: Record<string, string> = {};
  const linkUrls: Record<string, string> = {};

  for (const drawing of request.drawings ?? []) {
    const drawingId = randomId('d');
    drawingIds[drawing.key] = drawingId;
    const folderId = folderIds[drawing.folder];
    const firstUser = created[0] ?? 'seed';
    await pool.query('INSERT INTO drawings (id, folder_id, name, created_by) VALUES ($1, $2, $3, $4)', [drawingId, folderId, drawing.name, firstUser]);
    const model = createEmptyModel();
    const engine = new DrawingEngine(model, 1);
    for (const layer of drawing.layers ?? []) {
      model.layers[layer.name] = { ...layer };
    }
    let maxHandle = 0;
    for (const entity of drawing.entities ?? []) {
      const { handle, ...rest } = entity;
      const stored = { ...rest, handle } as Entity;
      engine.addEntity(stored);
      maxHandle = Math.max(maxHandle, handleNumber(handle));
    }
    if (drawing.generate) {
      const { lines, spacing } = drawing.generate;
      for (let i = 0; i < lines; i++) {
        const row = Math.floor(i / 100);
        const column = i % 100;
        const x = column * spacing;
        const y = row * spacing;
        const handle = engine.nextHandleFor('line');
        engine.addEntity({ type: 'line', handle, layer: '0', x1: x, y1: y, x2: x + 1, y2: y });
      }
    }
    for (const block of drawing.blocks ?? []) {
      model.blocks[block.name] = { name: block.name, base: block.base, entities: block.entities, attributes: block.attributes };
      for (const entity of block.entities) {
        maxHandle = Math.max(maxHandle, handleNumber(entity.handle));
      }
    }
    for (const style of drawing.dim_styles ?? []) {
      model.dim_styles[style.name] = { ...style };
    }
    for (const parameter of drawing.parameters ?? []) {
      model.parameters.push({ ...parameter });
    }
    for (const constraint of drawing.constraints ?? []) {
      model.constraints.push({
        id: randomId('c'),
        kind: constraint.kind as never,
        refs: constraint.refs as never,
        expression: constraint.expression,
      });
    }
    for (const xref of drawing.xrefs ?? []) {
      model.xrefs.push({
        name: xref.name,
        source: drawingIds[xref.source] ?? '',
        x: xref.x,
        y: xref.y,
        scale: xref.scale,
        rotation: xref.rotation,
        clip: (xref.clip as never) ?? null,
      });
    }
    for (const state of drawing.layer_states ?? []) {
      model.layer_states.push({ name: state.name, state: Object.fromEntries(Object.values(model.layers).map((layer) => [layer.name, { ...layer }])) });
    }
    for (const sheet of drawing.sheets ?? []) {
      const sheetId = randomId('s');
      sheetIds[sheet.key] = sheetId;
      const numberResult = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM sheets WHERE drawing_id = $1', [drawingId]);
      const sheetNumber = Number(numberResult.rows[0]?.count ?? 0) + 1;
      await pool.query('INSERT INTO sheets (id, drawing_id, name, size, number, locked, locked_by, created_by, attributes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        sheetId,
        drawingId,
        sheet.name,
        sheet.size,
        sheetNumber,
        sheet.locked ?? false,
        sheet.locked ? firstUser : null,
        firstUser,
        JSON.stringify(sheet.attributes ?? {}),
      ]);
      for (const viewport of sheet.viewports ?? []) {
        await pool.query('INSERT INTO viewports (id, sheet_id, x, y, width, height, scale, view_x, view_y, frozen_layers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
          randomId('vp'),
          sheetId,
          viewport.x,
          viewport.y,
          viewport.width,
          viewport.height,
          viewport.scale,
          viewport.view_x,
          viewport.view_y,
          JSON.stringify(viewport.frozen_layers ?? []),
        ]);
      }
    }
    engine.refreshAssociations();
    engine.setNextHandle(maxHandle + 1);
    await saveModel(drawingId, engine, 0);
    for (const entity of drawing.entities ?? []) {
      await pool.query('INSERT INTO entity_history (drawing_id, handle, revision, username, command, at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [
        drawingId, entity.handle, 0, firstUser, 'SEED', config.now,
      ]);
    }

    for (const sheet of drawing.sheets ?? []) {
      const sheetId = sheetIds[sheet.key];
      for (let i = 0; i < (sheet.publish ?? 0); i++) {
        const outcome = await publishVersion(sheetId, firstUser, config.storage, config.now);
        versionIds[`${sheet.key}:${outcome.version.number}`] = outcome.version.id;
      }
    }
  }

  // Second pass for records that reference published versions.
  for (const drawing of request.drawings ?? []) {
    const drawingId = drawingIds[drawing.key];
    const firstUser = created[0] ?? 'seed';
    for (const sheet of drawing.sheets ?? []) {
      const sheetId = sheetIds[sheet.key];
      for (const markup of sheet.markups ?? []) {
        const versionNumber = Number(markup.version ?? 1);
        const versionId = versionIds[`${sheet.key}:${versionNumber}`];
        if (!versionId) continue;
        await pool.query(
          'INSERT INTO markups (id, version_id, kind, x1, y1, x2, y2, text, flag, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            randomId('mk'),
            versionId,
            String(markup.kind ?? 'cloud'),
            Number(markup.x1 ?? 0),
            Number(markup.y1 ?? 0),
            Number(markup.x2 ?? 0),
            Number(markup.y2 ?? 0),
            (markup.text as string | undefined) ?? null,
            (markup.flag as string | null) ?? null,
            firstUser,
          ],
        );
      }
      for (const issue of sheet.issues ?? []) {
        const versionNumber = Number(issue.version ?? 1);
        const versionId = versionIds[`${sheet.key}:${versionNumber}`];
        if (!versionId) continue;
        const issueId = randomId('i');
        issueIds[String(issue.key ?? issueId)] = issueId;
        await pool.query('INSERT INTO issues (id, version_id, drawing_id, title, x, y, state, creator) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
          issueId,
          versionId,
          drawingId,
          String(issue.title ?? 'Issue'),
          Number(issue.x ?? 0),
          Number(issue.y ?? 0),
          String(issue.state ?? 'open'),
          String(issue.creator ?? firstUser),
        ]);
      }
      for (const rfi of sheet.rfis ?? []) {
        const issueId = issueIds[String(rfi.issue ?? '')];
        if (!issueId) continue;
        const rfiId = randomId('r');
        rfiIds[String(rfi.key ?? rfiId)] = rfiId;
        await pool.query('INSERT INTO rfis (id, issue_id, question, answer, asker, addressee, state, ball_in_court) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
          rfiId,
          issueId,
          String(rfi.question ?? 'Question'),
          (rfi.answer as string | null) ?? null,
          String(rfi.asker ?? firstUser),
          String(rfi.addressee ?? firstUser),
          String(rfi.state ?? 'draft'),
          String(rfi.state === 'sent' ? rfi.addressee : rfi.asker ?? firstUser),
        ]);
      }
      for (const review of sheet.reviews ?? []) {
        const versionNumber = Number(review.version ?? 1);
        const versionId = versionIds[`${sheet.key}:${versionNumber}`];
        if (!versionId) continue;
        await pool.query('UPDATE sheet_versions SET state = $2 WHERE id = $1', [versionId, String(review.state ?? 'in_review')]);
        const steps = (review.steps ?? []) as Array<{ role: string; state: string }>;
        if (steps.length) {
          for (const step of steps) {
            await pool.query('INSERT INTO review_steps (version_id, step, state, due_at) VALUES ($1,$2,$3,$4) ON CONFLICT (version_id, step) DO UPDATE SET state = $3', [
              versionId,
              step.role,
              step.state,
              new Date(config.now.getTime() + config.linkTtlMs),
            ]);
          }
        } else {
          await pool.query('INSERT INTO review_steps (version_id, step, state, due_at) VALUES ($1,$2,$3,$4) ON CONFLICT (version_id, step) DO UPDATE SET state = $3', [
            versionId,
            'markup',
            'pending',
            new Date(config.now.getTime() + config.linkTtlMs),
          ]);
          await pool.query('INSERT INTO review_steps (version_id, step, state) VALUES ($1,$2,$3) ON CONFLICT (version_id, step) DO UPDATE SET state = $3', [
            versionId,
            'manage',
            'waiting',
          ]);
        }
      }
      for (const link of sheet.links ?? []) {
        const versionNumber = Number(link.version ?? 1);
        const versionId = versionIds[`${sheet.key}:${versionNumber}`];
        if (!versionId) continue;
        const token = randomId('t').slice(2);
        await pool.query('INSERT INTO view_links (id, token, version_id, created_by, expires_at) VALUES ($1,$2,$3,$4,$5)', [
          randomId('l'),
          token,
          versionId,
          firstUser,
          new Date(config.now.getTime() + config.linkTtlMs),
        ]);
        linkUrls[String(link.key ?? token)] = `/v/${token}`;
      }
    }
  }

  return {
    users: created,
    folders: folderIds,
    drawings: drawingIds,
    sheets: sheetIds,
    versions: versionIds,
    issues: issueIds,
    rfis: rfiIds,
    links: linkUrls,
  };
}

export { ERROR_TEXT };
