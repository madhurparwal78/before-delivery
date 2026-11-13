import { ApiError, MESSAGES, quotaExceeded, textTooLarge, underlayTooLarge } from '../../shared/errors.js';
import type { ImportPayload } from '../../shared/apply.js';
import type { BlockDef, Entity, Layer } from '../../shared/model.js';
import { PLOT_TEXT_HEADER, parsePlotText } from '../../shared/plottext.js';
import { requireRole, requireSignedIn } from '../access.js';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { exportById, exportPayload, retryExport, startExport, type ExportFormat, type ExportRow } from '../exports.js';
import { readJson, readRawBody, requireString, route, sendBytes, sendJson } from '../http.js';
import { newId } from '../ids.js';
import { getObject, putObject, sha256Of, StorageUnavailable } from '../storage.js';
import { drawingAccess } from './folders.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPlotText(bytes: Buffer): boolean {
  const text = bytes.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(bytes) !== 0) return false;
  return text.split('\n')[0] === PLOT_TEXT_HEADER;
}

/** A merge renames each imported layer or block whose name already exists. */
function renameFor(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let k = 2; ; k += 1) {
    const candidate = `${name} (${k})`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function registerUploadRoutes(): void {
  route('POST', '/api/drawings/:id/underlays', async (context) => {
    const username = requireSignedIn(context.username);
    const { state, role } = await drawingAccess(username, context.params.id);
    requireRole(role, 'edit');
    const bytes = await readRawBody(context.req, config.underlayMaxBytes + 1);
    if (bytes.length > config.underlayMaxBytes) {
      throw new ApiError('too_large', underlayTooLarge(config.underlayMaxBytes));
    }
    if (!isPng(bytes) && !isJpeg(bytes)) throw new ApiError('wrong_type', MESSAGES.wrongTypeUnderlay);
    const digest = sha256Of(bytes);
    const existing = await one<{ id: string; key: string; bytes: number; x1: number; y1: number; x2: number; y2: number }>(
      'select id, key, bytes, x1, y1, x2, y2 from underlays where drawing_id = $1 and sha256 = $2',
      [state.id, digest],
    );
    if (existing) {
      sendJson(context.res, 200, existing);
      return;
    }
    const stored = await query<{ total: string }>(
      'select coalesce(sum(bytes),0) as total from underlays where drawing_id = $1',
      [state.id],
    );
    if (Number(stored[0].total) + bytes.length > config.drawingQuotaBytes) {
      throw new ApiError('quota_exceeded', quotaExceeded(config.drawingQuotaBytes));
    }
    const key = `underlays/${state.id}/${digest}.${isPng(bytes) ? 'png' : 'jpg'}`;
    try {
      await putObject(key, bytes);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable', MESSAGES.underlayOutage);
      throw error;
    }
    const id = newId('und');
    const corner = (name: string, fallback: number): number => {
      const raw = context.url.searchParams.get(name);
      const value = raw === null ? fallback : Number(raw);
      return Number.isFinite(value) ? value : fallback;
    };
    const placement = {
      x1: corner('x1', 0),
      y1: corner('y1', 0),
      x2: corner('x2', 10),
      y2: corner('y2', 10),
    };
    await query(
      'insert into underlays (id, drawing_id, key, bytes, sha256, x1, y1, x2, y2) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, state.id, key, bytes.length, digest, placement.x1, placement.y1, placement.x2, placement.y2],
    );
    sendJson(context.res, 201, { id, key, bytes: bytes.length, ...placement });
  });

  route('POST', '/api/drawings/:id/imports', async (context) => {
    const username = requireSignedIn(context.username);
    const { state, role } = await drawingAccess(username, context.params.id);
    requireRole(role, 'edit');
    const bytes = await readRawBody(context.req, config.textMaxBytes + 1);
    if (bytes.length > config.textMaxBytes) throw new ApiError('too_large', textTooLarge(config.textMaxBytes));
    if (!isPlotText(bytes)) throw new ApiError('wrong_type', MESSAGES.wrongTypeText);
    const digest = sha256Of(bytes);
    const key = `imports/${state.id}/${digest}.plot.txt`;
    try {
      await putObject(key, bytes);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable', MESSAGES.underlayOutage);
      throw error;
    }
    const outcome = parsePlotText(bytes.toString('utf8'));
    if (!outcome.ok) {
      throw new ApiError('parse_failed', MESSAGES.parseFailed, { lines: outcome.errors });
    }
    const takenLayers = new Set(state.model.layers.map((layer) => layer.name));
    const takenBlocks = new Set(state.model.blocks.map((block) => block.name));
    const renames: { from: string; to: string }[] = [];
    const layerNames = new Map<string, string>();
    const layers: Layer[] = [];
    for (const layer of outcome.parsed.layers) {
      if (layer.name === '0') {
        layerNames.set('0', '0');
        continue;
      }
      const name = renameFor(layer.name, takenLayers);
      if (name !== layer.name) renames.push({ from: layer.name, to: name });
      takenLayers.add(name);
      layerNames.set(layer.name, name);
      layers.push({ ...layer, name });
    }
    const blockNames = new Map<string, string>();
    const blocks: BlockDef[] = [];
    for (const block of outcome.parsed.blocks) {
      const name = renameFor(block.name, takenBlocks);
      if (name !== block.name) renames.push({ from: block.name, to: name });
      takenBlocks.add(name);
      blockNames.set(block.name, name);
      blocks.push({
        ...block,
        name,
        entities: block.entities.map((entity) => ({ ...entity, layer: layerNames.get(entity.layer) ?? entity.layer })),
      });
    }
    const entities: Entity[] = outcome.parsed.entities.map((entity) => {
      const moved = { ...entity, layer: layerNames.get(entity.layer) ?? entity.layer };
      if (moved.type === 'insert') moved.block = blockNames.get(moved.block) ?? moved.block;
      return moved;
    });
    const payload: ImportPayload = { layers, blocks, entities, renames };
    const importId = newId('imp');
    await query('insert into imports (id, drawing_id, key, payload) values ($1,$2,$3,$4)', [
      importId,
      state.id,
      key,
      JSON.stringify(payload),
    ]);
    sendJson(context.res, 201, {
      import_id: importId,
      key,
      adds: { entities: entities.length, layers: layers.length, blocks: blocks.length },
      renames,
    });
  });

  route('POST', '/api/drawings/:id/exports', async (context) => {
    const username = requireSignedIn(context.username);
    const { state, role } = await drawingAccess(username, context.params.id);
    requireRole(role, 'view');
    const body = await readJson(context);
    const format = requireString(body, 'format');
    if (format !== 'plot.txt' && format !== 'svg') throw new ApiError('invalid', MESSAGES.invalid);
    const job = await startExport(state.id, username, format as ExportFormat);
    sendJson(context.res, 202, exportPayload(job));
  });

  route('GET', '/api/exports/:id', async (context) => {
    const username = requireSignedIn(context.username);
    const job = await exportAccess(username, context.params.id);
    sendJson(context.res, 200, exportPayload(job));
  });

  route('POST', '/api/exports/:id/retry', async (context) => {
    const username = requireSignedIn(context.username);
    const job = await exportAccess(username, context.params.id);
    sendJson(context.res, 202, exportPayload(await retryExport(job)));
  });

  route('GET', '/api/exports/:id/download', async (context) => {
    const username = requireSignedIn(context.username);
    const job = await exportAccess(username, context.params.id);
    if (job.state !== 'ready' || !job.key) throw new ApiError('not_ready', MESSAGES.notReady);
    const bytes = await getObject(job.key);
    sendBytes(
      context.res,
      200,
      bytes,
      job.format === 'svg' ? 'image/svg+xml; charset=utf-8' : 'text/plain; charset=utf-8',
      { 'content-disposition': `attachment; filename="export.${job.format === 'svg' ? 'svg' : 'plot.txt'}"` },
    );
  });
}

async function exportAccess(username: string, exportId: string): Promise<ExportRow> {
  const job = await exportById(exportId);
  if (!job) throw new ApiError('not_found', MESSAGES.notFound);
  await drawingAccess(username, job.drawing_id);
  return job;
}
