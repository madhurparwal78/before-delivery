import { ApiError, MESSAGES } from '../../shared/errors.js';
import { materializeEntity, refreshDerived } from '../../shared/apply.js';
import { solveConstraints } from '../../shared/constraints.js';
import type { Constraint, DimStyle, DrawingModel, Entity, Layer, Parameter } from '../../shared/model.js';
import { emptyModel, handleNumber } from '../../shared/model.js';
import type { EntityInput } from '../../shared/operations.js';
import type { Role } from '../../shared/transitions.js';
import { config } from '../config.js';
import { advanceClock, now, nowIso } from '../clock.js';
import { one, query } from '../db.js';
import { forgetDrawing, loadDrawing } from '../drawings.js';
import {
  arrayField,
  booleanField,
  numberField,
  objectField,
  readJson,
  requireString,
  route,
  sendEmpty,
  sendJson,
  sessionCookie,
  stringField,
  cookies,
} from '../http.js';
import { newId, newToken } from '../ids.js';
import { publishVersion, sheetById, versionsOfSheet, type SheetRow } from '../publish.js';
import { setStorageDown } from '../storage.js';
import { createUser, startSession, userExists } from '../sessions.js';
import { parseEntityInput, parseOperations } from '../validate.js';
import { runBatch } from './ops.js';

const startViews = new Map<string, { zoom: number; pan_x: number; pan_y: number }>();

export function startViewFor(token: string | undefined, drawingId: string): { zoom: number; pan_x: number; pan_y: number } | null {
  if (!token) return null;
  return startViews.get(`${token}:${drawingId}`) ?? null;
}

function gradingOnly(): void {
  if (!config.grading) throw new ApiError('not_found', MESSAGES.notFound);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('invalid', MESSAGES.invalid);
  return value as Record<string, unknown>;
}

function list(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ApiError('invalid', MESSAGES.invalid);
  return value.map(record);
}

function seedLayer(source: Record<string, unknown>): Layer {
  return {
    name: String(source.name ?? '0'),
    colour: (source.colour ?? 'white') as Layer['colour'],
    linetype: (source.linetype ?? 'Continuous') as Layer['linetype'],
    lineweight: (source.lineweight ?? '0.25') as Layer['lineweight'],
    on: source.on === undefined ? true : source.on === true,
    frozen: source.frozen === true,
    locked: source.locked === true,
  };
}

function seedModel(source: Record<string, unknown>): DrawingModel {
  const model = emptyModel();
  for (const layer of list(source.layers)) {
    const built = seedLayer(layer);
    const index = model.layers.findIndex((candidate) => candidate.name === built.name);
    if (index >= 0) model.layers[index] = built;
    else model.layers.push(built);
  }
  for (const block of list(source.blocks)) {
    const entities: Entity[] = [];
    for (const entity of list(block.entities)) {
      const input = parseEntityInput(entity);
      const handle = typeof entity.handle === 'string' ? entity.handle : `L${model.next_handle}`;
      entities.push(materializeEntity(model, input, handle));
      model.next_handle = Math.max(model.next_handle, handleNumber(handle) + 1);
    }
    model.blocks.push({
      name: String(block.name),
      base: Array.isArray(block.base) ? [Number(block.base[0]), Number(block.base[1])] : [0, 0],
      entities,
      attributes: list(block.attributes).map((attribute) => ({
        tag: String(attribute.tag),
        default: String(attribute.default ?? ''),
      })),
    });
  }
  for (const style of list(source.dim_styles)) {
    const built: DimStyle = {
      name: String(style.name),
      precision: Number(style.precision ?? 2),
      prefix: String(style.prefix ?? ''),
      suffix: String(style.suffix ?? ''),
      scale: Number(style.scale ?? 1),
      text_height_mm: Number(style.text_height_mm ?? 2.5),
    };
    const index = model.dim_styles.findIndex((candidate) => candidate.name === built.name);
    if (index >= 0) model.dim_styles[index] = built;
    else model.dim_styles.push(built);
  }
  for (const parameter of list(source.parameters)) {
    const built: Parameter = { name: String(parameter.name), expression: String(parameter.expression) };
    model.parameters.push(built);
  }
  for (const entity of list(source.entities)) {
    const input: EntityInput = parseEntityInput(entity);
    const handle = typeof entity.handle === 'string' ? entity.handle : undefined;
    const assigned = handle ?? `${input.type === 'line' ? 'L' : input.type === 'circle' ? 'C' : 'X'}${model.next_handle}`;
    model.entities.push(materializeEntity(model, input, assigned));
    model.next_handle = Math.max(model.next_handle, handleNumber(assigned) + 1);
  }
  const generate = objectField(source, 'generate');
  if (generate) {
    const lines = Number(generate.lines ?? 0);
    const spacing = Number(generate.spacing ?? 1);
    for (let index = 0; index < lines; index += 1) {
      const row = Math.floor(index / 100);
      const column = index % 100;
      const handle = `L${model.next_handle}`;
      model.entities.push(
        materializeEntity(
          model,
          {
            type: 'line',
            layer: '0',
            x1: column * spacing,
            y1: row * spacing,
            x2: column * spacing + 1,
            y2: row * spacing,
          },
          handle,
        ),
      );
      model.next_handle += 1;
    }
  }
  for (const constraint of list(source.constraints)) {
    const built: Constraint = {
      id: newId('cst'),
      kind: constraint.kind as Constraint['kind'],
      refs: Array.isArray(constraint.refs)
        ? constraint.refs.map((ref) => {
            const entry = record(ref);
            return {
              handle: String(entry.handle),
              point: entry.point === 'start' || entry.point === 'end' ? (entry.point as 'start' | 'end') : null,
            };
          })
        : [],
      expression: typeof constraint.expression === 'string' ? constraint.expression : null,
    };
    model.constraints.push(built);
  }
  for (const state of list(source.layer_states)) {
    model.layer_states.push({ name: String(state.name), layers: structuredClone(model.layers) });
  }
  if (model.constraints.length > 0) solveConstraints(model);
  refreshDerived(model);
  return model;
}

interface SeedResult {
  users: string[];
  folders: Record<string, string>;
  drawings: Record<string, string>;
  sheets: Record<string, string>;
  versions: Record<string, string>;
  issues: Record<string, string>;
  rfis: Record<string, string>;
  links: Record<string, string>;
}

async function seedSheets(
  drawingId: string,
  sheets: Record<string, unknown>[],
  result: SeedResult,
  creator: string,
): Promise<void> {
  const state = await loadDrawing(drawingId);
  if (!state) return;
  const existing = await query<{ count: string }>('select count(*) as count from sheets where drawing_id = $1', [drawingId]);
  let number = Number(existing[0].count);
  for (const sheet of sheets) {
    number += 1;
    const id = newId('sht');
    const size = sheet.size === 'A4' ? 'A4' : 'A3';
    await query(
      'insert into sheets (id, drawing_id, name, size, number, locked, locked_by, attributes, creator) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        drawingId,
        String(sheet.name ?? `Sheet ${number}`),
        size,
        number,
        sheet.locked === true,
        sheet.locked === true ? creator : null,
        JSON.stringify({ Project: '', 'Checked by': '', ...(objectField(sheet, 'attributes') ?? {}) }),
        creator,
      ],
    );
    if (typeof sheet.key === 'string') result.sheets[sheet.key] = id;
    for (const viewport of list(sheet.viewports)) {
      await query(
        'insert into viewports (id, sheet_id, x, y, width, height, scale, view_x, view_y, frozen_layers) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          newId('vp'),
          id,
          Number(viewport.x ?? 0),
          Number(viewport.y ?? 0),
          Number(viewport.width ?? 100),
          Number(viewport.height ?? 100),
          String(viewport.scale ?? '1:50'),
          Number(viewport.view_x ?? 0),
          Number(viewport.view_y ?? 0),
          JSON.stringify(Array.isArray(viewport.frozen_layers) ? viewport.frozen_layers : []),
        ],
      );
    }
    const publishCount = Number(sheet.publish ?? 0);
    const sheetRow = (await sheetById(id)) as SheetRow;
    for (let index = 0; index < publishCount; index += 1) {
      const version = await publishVersion(state, sheetRow);
      if (typeof sheet.key === 'string') result.versions[`${sheet.key}:${version.number}`] = version.id;
    }
    const versions = await versionsOfSheet(id);
    const versionByNumber = (wanted: number): string | null => {
      const found = versions.find((version) => version.number === wanted);
      return found ? found.id : null;
    };
    for (const markup of list(sheet.markups)) {
      const versionId = versionByNumber(Number(markup.version ?? publishCount));
      if (!versionId) continue;
      await query(
        'insert into markups (id, version_id, kind, x1, y1, x2, y2, text, author) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          newId('mk'),
          versionId,
          String(markup.kind ?? 'cloud'),
          Number(markup.x1 ?? 0),
          Number(markup.y1 ?? 0),
          Number(markup.x2 ?? 0),
          Number(markup.y2 ?? 0),
          typeof markup.text === 'string' ? markup.text : null,
          String(markup.author ?? creator),
        ],
      );
    }
    for (const issue of list(sheet.issues)) {
      const versionId = versionByNumber(Number(issue.version ?? publishCount));
      if (!versionId) continue;
      const issueId = newId('iss');
      await query(
        'insert into issues (id, drawing_id, version_id, title, x, y, state, creator) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          issueId,
          drawingId,
          versionId,
          String(issue.title ?? 'Issue'),
          Number(issue.x ?? 0),
          Number(issue.y ?? 0),
          String(issue.state ?? 'open'),
          String(issue.creator ?? creator),
        ],
      );
      if (typeof issue.key === 'string') result.issues[issue.key] = issueId;
    }
    for (const rfi of list(sheet.rfis)) {
      const issueKey = String(rfi.issue ?? '');
      const issueId = result.issues[issueKey];
      if (!issueId) continue;
      const rfiId = newId('rfi');
      const asker = String(rfi.asker ?? creator);
      const addressee = String(rfi.addressee ?? creator);
      const state2 = String(rfi.state ?? 'draft');
      const ball = state2 === 'sent' ? addressee : asker;
      await query(
        'insert into rfis (id, issue_id, question, state, asker, addressee, ball_in_court, answer) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [rfiId, issueId, String(rfi.question ?? 'Question'), state2, asker, addressee, ball, typeof rfi.answer === 'string' ? rfi.answer : null],
      );
      if (typeof rfi.key === 'string') result.rfis[rfi.key] = rfiId;
    }
    for (const review of list(sheet.reviews)) {
      const versionId = versionByNumber(Number(review.version ?? publishCount));
      if (!versionId) continue;
      const reviewState = String(review.state ?? 'in_review');
      await query('update versions set state = $2 where id = $1', [versionId, reviewState]);
      const steps = list(review.steps);
      const defaults = [
        { role: 'markup', state: 'pending' },
        { role: 'manage', state: 'waiting' },
      ];
      const used = steps.length > 0 ? steps : defaults;
      let position = 0;
      for (const step of used) {
        const stepState = String(step.state ?? 'waiting');
        await query(
          'insert into review_steps (id, version_id, role, state, position, due_at) values ($1,$2,$3,$4,$5,$6)',
          [
            newId('stp'),
            versionId,
            String(step.role ?? (position === 0 ? 'markup' : 'manage')),
            stepState,
            position,
            stepState === 'pending' ? new Date(now() + config.reviewTtlMs).toISOString() : null,
          ],
        );
        position += 1;
      }
    }
    for (const link of list(sheet.links)) {
      const versionId = versionByNumber(Number(link.version ?? publishCount));
      if (!versionId) continue;
      const token = newToken();
      const linkId = newId('lnk');
      await query('insert into links (id, version_id, token, expires_at) values ($1,$2,$3,$4)', [
        linkId,
        versionId,
        token,
        new Date(now() + config.linkTtlMs).toISOString(),
      ]);
      if (typeof link.key === 'string') result.links[link.key] = `/v/${token}`;
    }
  }
}

export function registerGradingRoutes(): void {
  route('POST', '/api/grading/seed', async (context) => {
    gradingOnly();
    const body = await readJson(context);
    const result: SeedResult = {
      users: [],
      folders: {},
      drawings: {},
      sheets: {},
      versions: {},
      issues: {},
      rfis: {},
      links: {},
    };
    for (const user of list(body.users)) {
      const username = String(user.username).toLowerCase();
      if (await userExists(username)) throw new ApiError('username_taken', MESSAGES.usernameTaken);
      await createUser(username, String(user.password ?? 'plotfold-seed'));
      result.users.push(username);
    }
    for (const folder of list(body.folders)) {
      const id = newId('fld');
      const parentKey = typeof folder.parent === 'string' ? folder.parent : null;
      const parentId = parentKey ? result.folders[parentKey] ?? null : null;
      await query('insert into folders (id, name, parent_id) values ($1,$2,$3)', [id, String(folder.name), parentId]);
      const roles = objectField(folder, 'roles') ?? {};
      for (const [username, role] of Object.entries(roles)) {
        await query(
          'insert into folder_roles (folder_id, username, role) values ($1,$2,$3) on conflict (folder_id, username) do update set role = $3',
          [id, username.toLowerCase(), String(role) as Role],
        );
      }
      if (typeof folder.key === 'string') result.folders[folder.key] = id;
    }

    const drawingSources = list(body.drawings);
    for (const drawing of drawingSources) {
      const folderId = result.folders[String(drawing.folder)] ?? null;
      if (!folderId) throw new ApiError('invalid', MESSAGES.invalid);
      const id = newId('dwg');
      const model = seedModel(drawing);
      await query('insert into drawings (id, folder_id, name, revision, model) values ($1,$2,$3,0,$4)', [
        id,
        folderId,
        String(drawing.name),
        JSON.stringify(model),
      ]);
      forgetDrawing(id);
      if (typeof drawing.key === 'string') result.drawings[drawing.key] = id;
    }
    for (const drawing of drawingSources) {
      const id = result.drawings[String(drawing.key)];
      if (!id) continue;
      const xrefs = list(drawing.xrefs);
      if (xrefs.length === 0) continue;
      const state = await loadDrawing(id);
      if (!state) continue;
      for (const xref of xrefs) {
        const sourceId = result.drawings[String(xref.source)];
        if (!sourceId) continue;
        state.model.xrefs.push({
          name: String(xref.name),
          source: sourceId,
          x: Number(xref.x ?? 0),
          y: Number(xref.y ?? 0),
          scale: Number(xref.scale ?? 1),
          rotation: Number(xref.rotation ?? 0),
          clip: Array.isArray(xref.clip)
            ? [Number(xref.clip[0]), Number(xref.clip[1]), Number(xref.clip[2]), Number(xref.clip[3])]
            : null,
          version_number: null,
        });
      }
      await query('update drawings set model = $2 where id = $1', [id, JSON.stringify(state.model)]);
    }
    for (const drawing of drawingSources) {
      const id = result.drawings[String(drawing.key)];
      if (!id) continue;
      const owner = await one<{ username: string }>(
        'select username from folder_roles where folder_id = (select folder_id from drawings where id = $1) order by case role when \'manage\' then 0 when \'edit\' then 1 when \'markup\' then 2 else 3 end limit 1',
        [id],
      );
      await seedSheets(id, list(drawing.sheets), result, owner ? owner.username : 'seed');
    }
    for (const drawing of drawingSources) {
      const id = result.drawings[String(drawing.key)];
      if (!id) continue;
      const state = await loadDrawing(id);
      if (!state) continue;
      for (const xref of state.model.xrefs) {
        const published = await query<{ number: number }>(
          `select v.number from versions v join sheets s on s.id = v.sheet_id
            where s.drawing_id = $1 and v.state <> 'publishing' order by v.created_at desc limit 1`,
          [xref.source],
        );
        if (published.length > 0) xref.version_number = published[0].number;
      }
      await query('update drawings set model = $2 where id = $1', [id, JSON.stringify(state.model)]);
    }
    sendJson(context.res, 201, result);
  });

  route('POST', '/api/grading/session', async (context) => {
    gradingOnly();
    const body = await readJson(context);
    const username = requireString(body, 'username').toLowerCase();
    if (!(await userExists(username))) throw new ApiError('not_found', MESSAGES.notFound);
    const token = await startSession(username);
    sendJson(context.res, 200, { username }, { 'set-cookie': sessionCookie(token) });
  });

  route('POST', '/api/grading/view', async (context) => {
    gradingOnly();
    const body = await readJson(context);
    const drawingId = requireString(body, 'drawing');
    const token = cookies(context.req).plot_session ?? '';
    startViews.set(`${token}:${drawingId}`, {
      zoom: numberField(body, 'zoom') ?? 1,
      pan_x: numberField(body, 'pan_x') ?? 0,
      pan_y: numberField(body, 'pan_y') ?? 0,
    });
    sendEmpty(context.res, 204);
  });

  route('POST', '/api/grading/clock', async (context) => {
    gradingOnly();
    const body = await readJson(context);
    advanceClock(numberField(body, 'advance_ms') ?? 0);
    sendJson(context.res, 200, { now: nowIso() });
  });

  route('POST', '/api/grading/drawings/:id/ops', async (context) => {
    gradingOnly();
    const body = await readJson(context);
    const as = requireString(body, 'as').toLowerCase();
    const state = await loadDrawing(context.params.id);
    if (!state) throw new ApiError('not_found', MESSAGES.notFound);
    const operations = parseOperations(arrayField(body, 'ops') ?? [], () => newId('op'));
    const outcome = await runBatch(state, as, {
      base_revision: numberField(body, 'base_revision') ?? state.revision,
      group_id: stringField(body, 'group_id') ?? newId('grp'),
      command: stringField(body, 'command') ?? 'EDIT',
      ops: operations,
    });
    sendJson(context.res, 200, outcome);
  });

  route('POST', '/api/grading/storage', async (context) => {
    gradingOnly();
    const body = await readJson(context);
    const down = booleanField(body, 'down') ?? false;
    setStorageDown(down);
    sendJson(context.res, 200, { down });
  });
}
