import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { alreadySent, json, type RouteDefinition } from '../http/pipeline.js';
import { sendBytes } from '../http/respond.js';
import { findWorkshop, loadBoard } from '../board/repository.js';
import { recapBoardOf, rankRecapClusters } from '../recap/content.js';
import { getObject, objectKeys, StorageUnavailable, storageError } from '../services/s3.js';

interface RecapTokenRow {
  workshop_id: string;
  status: 'queued' | 'complete';
  reason: string | null;
  files_stored_at: Date | null;
  invoice_number: string | null;
  invoice_amount: string | null;
  invoice_currency: string | null;
}

async function findByToken(token: string): Promise<RecapTokenRow> {
  const result = await pool.query<RecapTokenRow>(
    `SELECT workshop_id, status, reason, files_stored_at, invoice_number, invoice_amount, invoice_currency
       FROM recaps WHERE recap_token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) throw new AppError('not_found');
  return row;
}

export const recapRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/recaps/:token',
    auth: 'none',
    handle: async ({ context }) => {
      const token = context.params.token as string;
      const recap = await findByToken(token);
      const workshop = await findWorkshop(pool, recap.workshop_id);
      if (workshop === null) throw new AppError('not_found');

      const board = recapBoardOf(await loadBoard(pool, workshop.id));
      // `files` is empty until the files are stored.
      const files =
        recap.files_stored_at === null
          ? []
          : [
              {
                name: 'board.pdf',
                label: 'Board PDF',
                url: `/api/recaps/${token}/files/board.pdf`,
                contentType: 'application/pdf',
              },
              {
                name: 'notes.csv',
                label: 'Notes and votes CSV',
                url: `/api/recaps/${token}/files/notes.csv`,
                contentType: 'text/csv; charset=utf-8',
              },
              ...board.frames.map((frame) => ({
                name: `frame-${frame.id}.png`,
                label: `Frame image: ${frame.title}`,
                url: `/api/recaps/${token}/files/frame-${frame.id}.png`,
                contentType: 'image/png',
              })),
            ];

      return json(200, {
        workshop: {
          title: workshop.title,
          scheduledStart: workshop.scheduledStart,
          scheduledEnd: workshop.scheduledEnd,
          timeZone: workshop.timeZone,
        },
        status: recap.status,
        reason: recap.reason,
        invoice:
          recap.invoice_number === null
            ? null
            : {
                number: recap.invoice_number,
                amount: recap.invoice_amount,
                currency: recap.invoice_currency,
              },
        files,
        // No participant name and no facilitator-only note reaches this response.
        clusters: rankRecapClusters(board).map((entry) => ({
          frame: entry.frame.title,
          title: entry.cluster.title,
          dotTotal: entry.dotTotal,
          notes: entry.noteTexts,
        })),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/recaps/:token/files/:name',
    auth: 'none',
    handle: async ({ context }) => {
      const recap = await findByToken(context.params.token as string);
      const name = context.params.name as string;
      if (recap.files_stored_at === null) throw new AppError('recap_not_ready');

      const frameMatch = /^frame-(.+)\.png$/.exec(name);
      let objectKey: string;
      let contentType: string;
      if (name === 'board.pdf') {
        objectKey = objectKeys.recapPdf(recap.workshop_id);
        contentType = 'application/pdf';
      } else if (name === 'notes.csv') {
        objectKey = objectKeys.recapCsv(recap.workshop_id);
        contentType = 'text/csv; charset=utf-8';
      } else if (frameMatch) {
        objectKey = objectKeys.recapFramePng(recap.workshop_id, frameMatch[1] as string);
        contentType = 'image/png';
      } else {
        throw new AppError('not_found');
      }

      let object;
      try {
        object = await getObject(objectKey);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw storageError();
        throw error;
      }
      if (object === null) throw new AppError('not_found');
      sendBytes(context, 200, object.bytes, contentType, { 'Content-Disposition': 'inline' });
      return alreadySent;
    },
  },
];
