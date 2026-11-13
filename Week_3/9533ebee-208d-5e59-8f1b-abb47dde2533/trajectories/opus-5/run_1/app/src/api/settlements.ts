/**
 * Settlement receipts and the stored statement PDF.
 */

import { query } from '../db/pool.ts';
import { loadSettlement } from '../market/settlements.ts';
import { getObject, StorageUnreachable } from '../services/s3.ts';
import { notFound, pdfPending, statementStoreUnavailable } from '../http/problem.ts';
import type { Member } from '../http/sessions.ts';
import type { Reply, Request, Route } from '../http/router.ts';
import { settlementDto } from './dto.ts';

async function readSettlement(
  _request: Request,
  _member: Member,
  settlementId: string,
): Promise<Reply> {
  const record = await loadSettlement({ query }, settlementId);
  if (record === null) throw notFound();
  return { status: 200, body: await settlementDto({ query }, record) };
}

async function readStatementPdf(
  _request: Request,
  _member: Member,
  settlementId: string,
): Promise<Reply> {
  const record = await loadSettlement({ query }, settlementId);
  if (record === null) throw notFound();
  if (record.pdfRenderedAtMs === null) throw pdfPending();
  let bytes: Uint8Array | null;
  try {
    bytes = await getObject(record.pdfKey);
  } catch (error) {
    if (error instanceof StorageUnreachable) throw statementStoreUnavailable();
    throw error;
  }
  if (bytes === null) throw pdfPending();
  return { status: 200, raw: { contentType: 'application/pdf', bytes } };
}

export const settlementRoutes: readonly Route[] = [
  {
    kind: 'settlement',
    method: 'GET',
    pattern: '/api/settlements/:id',
    handler: readSettlement,
  },
  {
    kind: 'settlement',
    method: 'GET',
    pattern: '/api/settlements/:id/statement.pdf',
    handler: readStatementPdf,
  },
];
