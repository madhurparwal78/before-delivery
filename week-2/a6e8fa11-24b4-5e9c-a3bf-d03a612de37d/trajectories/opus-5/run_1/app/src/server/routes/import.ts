import { LIMITS, MAX_WORKBOOK_NAME_CHARS } from '../../shared/limits';
import { ClientOp } from '../../shared/ops';
import { roleCan } from '../../shared/roles';
import { transaction } from '../db';
import { requireMember } from '../http/context';
import { apiErrors } from '../http/errors';
import { parseMultipart } from '../http/multipart';
import { addRoute } from '../http/pipeline';
import { bodyHash, uuid } from '../secrets';
import { readImportFile } from '../domain/import';
import { requireRequestKey, withRequestKey } from '../domain/requestKeys';
import { insertOps } from '../domain/state';
import { WorkbookRow, workbookSummary } from '../domain/workbooks';
import { deleteObject, putObject } from '../services/storage';

const WORKBOOK_COLUMNS = `id, station_id, name, state, closes_at_local, closes_at_utc, original_key,
  head_seq, created_by, created_at, updated_at`;

function uniqueSheetName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) {
    taken.add(name.toLowerCase());
    return name;
  }
  for (let suffix = 2; ; suffix++) {
    const candidate = `${name.slice(0, 28)} (${suffix})`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

export function registerImportRoutes(): void {
  addRoute({
    method: 'POST',
    pattern: '/api/workbooks/import',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'createWorkbooks')) throw apiErrors.forbidden();
      const key = requireRequestKey(ctx.req.headers['idempotency-key'] as string | undefined);
      const parts = parseMultipart(ctx.rawBody, ctx.req.headers['content-type']);
      const filePart = parts?.find((part) => part.name === 'file');
      if (!parts || !filePart) {
        throw apiErrors.validation({ file: 'Choose a workbook file to import.' });
      }
      if (filePart.data.length > LIMITS.maxImportBytes) {
        throw apiErrors.payloadTooLarge(LIMITS.maxImportBytes);
      }
      const fileName = filePart.fileName ?? 'workbook';
      const namePart = parts.find((part) => part.name === 'name');
      const givenName = namePart ? namePart.data.toString('utf8').trim() : '';
      const fallbackName = fileName.replace(/\.[^.]*$/, '').slice(0, MAX_WORKBOOK_NAME_CHARS) || 'Imported workbook';
      const name = givenName === '' ? fallbackName : givenName;
      if (name.length < 1 || name.length > MAX_WORKBOOK_NAME_CHARS) {
        throw apiErrors.validation({ name: 'Give the workbook a name of 1 to 80 characters.' });
      }
      // The same file bytes and name make the same request, whatever the multipart boundary.
      const identity = Buffer.concat([Buffer.from(bodyHash(filePart.data), 'hex'), Buffer.from(name, 'utf8')]);
      const stored = await withRequestKey(
        {
          memberId: member.id,
          endpoint: 'import-workbook',
          key,
          body: identity,
        },
        async () => {
          const imported = readImportFile(filePart.data, fileName);
          const workbookId = uuid();
          const originalKey =
            `stations/${member.stationId}/imports/${workbookId}/original.` + (imported.kind === 'xlsx' ? 'xlsx' : 'csv');
          await putObject(
            originalKey,
            filePart.data,
            imported.kind === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'text/csv; charset=utf-8',
          );

          try {
            const result = await transaction(async (client) => {
              const row = (
                await client.query(
                  `insert into workbooks (id, station_id, name, state, head_seq, created_by, original_key)
                   values ($1,$2,$3,'draft',0,$4,$5) returning ${WORKBOOK_COLUMNS}`,
                  [workbookId, member.stationId, name, member.id, originalKey],
                )
              ).rows[0] as WorkbookRow;
              const taken = new Set<string>();
              const sheets = imported.sheets.map((sheet) => ({
                id: uuid(),
                name: uniqueSheetName(sheet.name, taken),
                cells: sheet.cells,
              }));
              const ops: ClientOp[] = [];
              for (const sheet of sheets) {
                ops.push({ opId: uuid(), type: 'addSheet', sheetId: sheet.id, name: sheet.name });
                for (const [ref, cell] of sheet.cells) {
                  ops.push({ opId: uuid(), type: 'setCell', sheetId: sheet.id, cell: ref, input: cell.input });
                  if (cell.numberFormat !== 'general' || cell.bold) {
                    ops.push({
                      opId: uuid(),
                      type: 'setFormat',
                      sheetId: sheet.id,
                      range: ref,
                      format: { numberFormat: cell.numberFormat, bold: cell.bold },
                    });
                  }
                }
              }
              const headSeq = await insertOps(client, workbookId, 0, member.id, ops);
              await client.query('update workbooks set head_seq = $2 where id = $1', [workbookId, headSeq]);
              return {
                workbook: workbookSummary({ ...row, head_seq: headSeq }, sheets.length),
                sheets: sheets.map((sheet) => ({ id: sheet.id, name: sheet.name })),
                originalKey,
              };
            });
            return { status: 201, text: JSON.stringify(result) };
          } catch (failure) {
            await deleteObject(originalKey).catch(() => undefined);
            throw failure;
          }
        },
      );
      ctx.res.writeHead(stored.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      ctx.res.end(stored.text);
    },
  });
}
