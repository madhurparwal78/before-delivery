// Drawing text files: stored byte for byte before they are parsed; a parsed file waits in PostgreSQL for its Merge.
import { createHash, randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError } from '../shared/errors.ts';
import { isPlotfoldText, parsePlotfold, previewImport, type ParsedDrawing } from '../shared/model/index.ts';
import { MINIMUM_ROLE } from '../shared/rules.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { getDrawing } from './drawings.ts';
import { withOutageText } from './outage.ts';
import { roleOnDrawing } from './roles.ts';
import { route } from './router.ts';
import { s3 } from './s3.ts';

/** The parsed file of an upload, for the `import_merge` operation; `not_found` unless it was uploaded to this drawing. */
export async function parsedImport(drawingId: string, importId: string): Promise<ParsedDrawing> {
  const rows = await db.query<{ parsed: ParsedDrawing }>('SELECT parsed FROM imports WHERE id = $1 AND drawing_id = $2', [importId, drawingId]);
  if (rows.length === 0) throw new ApiError('not_found', copy.NOT_FOUND);
  return rows[0].parsed;
}

route('POST', '/api/drawings/:id/imports', async (ctx) => {
  const drawingId = ctx.params.id;
  await roleOnDrawing(ctx, drawingId, MINIMUM_ROLE.editDrawing);
  const bytes = ctx.rawBody();
  if (!isPlotfoldText(bytes)) throw new ApiError('wrong_type', copy.NOT_A_PLOTFOLD_FILE);
  const key = `imports/${drawingId}/${createHash('sha256').update(bytes).digest('hex')}.plot.txt`;
  await withOutageText(copy.UNDERLAY_OUTAGE, () => s3.put(key, bytes, 'text/plain; charset=utf-8'));
  const parsed = parsePlotfold(bytes.toString('utf8'));
  if (!parsed.ok) throw new ApiError('parse_failed', copy.IMPORT_ERRORS, { lines: parsed.errors });
  const importId = randomUUID();
  await db.query('INSERT INTO imports (id, drawing_id, key, parsed) VALUES ($1, $2, $3, $4)', [importId, drawingId, key, JSON.stringify(parsed.drawing)]);
  return ctx.reply(201, { import_id: importId, key, ...previewImport((await getDrawing(drawingId)).state, parsed.drawing) });
}, { bodyLimit: config.textMaxBytes });
