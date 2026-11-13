import { appendLog, inHousehold, one, rows } from '../db';
import { knownIdOrNotFound } from '../db/ids';
import { costColumns, costEtag, mapCost } from '../db/repo';
import { fail, failField } from '../errors';
import { ApiResponse, Ctx, cleanText } from '../http/context';
import { notModified, requireIfMatch } from '../http/protocol';
import { formatInstant } from '../domain/time';
import { logFault } from '../log';
import {
  StorageUnavailable,
  deleteObject,
  getObject,
  putAndVerify,
  receiptKey,
} from '../services/storage';

/** A receipt's type comes from its leading bytes alone. */
function sniffContentType(body: Buffer): string | null {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (body.length >= 8 && body.subarray(0, 8).equals(png)) return 'image/png';
  if (body.length >= 5 && body.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

function readFilename(ctx: Ctx): string {
  const raw = ctx.url.searchParams.get('filename');
  if (raw === null) failField('filename', 'Use 1 to 200 characters.');
  return cleanText('filename', raw, 'Use 1 to 200 characters.', { min: 1, max: 200 });
}

export async function uploadReceipt(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const costId = knownIdOrNotFound(ctx.params.id);
  const existing = await rows(`SELECT ${costColumns} FROM costs WHERE household_id = $1 AND id = $2`, [
    household.id,
    costId,
  ]);
  const row = existing[0];
  if (!row) fail('not_found');
  const cost = mapCost(row);
  if (cost.paidBy !== ctx.user.role) fail('not_your_request');
  requireIfMatch(ctx, costEtag(cost));
  if (cost.state !== 'draft' && cost.state !== 'sent' && cost.state !== 'accepted') fail('invalid_transition');
  const filename = readFilename(ctx);
  const contentType = sniffContentType(ctx.raw);
  if (contentType === null) failField('receipt', "The file isn't a JPEG, PNG or PDF.");
  const count = await one('SELECT count(*)::int AS total FROM receipts WHERE cost_id = $1', [cost.id]);
  if (((count?.total as number) ?? 0) >= 5) fail('receipt_limit');

  const receiptId = ((await rows("SELECT nextval('entity_ids')::text AS id"))[0] as { id: string }).id;
  const key = receiptKey(household.id, receiptId);
  let sha256: string;
  try {
    sha256 = await putAndVerify(key, ctx.raw, contentType);
  } catch (error) {
    // a write that timed out may still have landed: leave nothing behind
    await deleteObject(key).catch((cleanupError: unknown) => logFault('receipt object cleanup', cleanupError));
    if (error instanceof StorageUnavailable) fail('storage_unavailable');
    throw error;
  }
  try {
    return await inHousehold(household.id, async (client) => {
      const current = (
        await client.query(`SELECT ${costColumns} FROM costs WHERE household_id = $1 AND id = $2`, [
          household.id,
          cost.id,
        ])
      ).rows[0];
      if (!current) fail('not_found');
      const latest = mapCost(current);
      requireIfMatch(ctx, costEtag(latest));
      if (latest.state !== 'draft' && latest.state !== 'sent' && latest.state !== 'accepted') {
        fail('invalid_transition');
      }
      const total = (
        await client.query('SELECT count(*)::int AS total FROM receipts WHERE cost_id = $1', [cost.id])
      ).rows[0] as { total: number };
      if (total.total >= 5) fail('receipt_limit');
      const stored = await client.query(
        `INSERT INTO receipts (id, household_id, cost_id, content_type, bytes, sha256, filename)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING stored_at`,
        [receiptId, household.id, cost.id, contentType, ctx.raw.length, sha256, filename],
      );
      const bumped = await client.query('UPDATE costs SET rev = rev + 1 WHERE id = $1 RETURNING rev', [cost.id]);
      await appendLog(client, household.id, ctx.user.role, 'receipt.stored', receiptId);
      const storedAt = (stored.rows[0] as { stored_at: Date }).stored_at;
      return {
        status: 201,
        headers: { ETag: costEtag({ ...latest, rev: (bumped.rows[0] as { rev: number }).rev }) },
        json: {
          id: receiptId,
          contentType,
          bytes: ctx.raw.length,
          sha256,
          filename,
          storedAt: formatInstant('UTC', storedAt.getTime()),
        },
      };
    });
  } catch (error) {
    await deleteObject(key).catch((cleanupError: unknown) => logFault('receipt object cleanup', cleanupError));
    throw error;
  }
}

function asciiFilename(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return ascii === '' ? 'receipt' : ascii;
}

export async function downloadReceipt(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const costId = knownIdOrNotFound(ctx.params.id);
  const receiptId = knownIdOrNotFound(ctx.params.rid);
  const found = await one(
    `SELECT r.id::text AS id, r.content_type, r.bytes, r.sha256, r.filename
     FROM receipts r WHERE r.household_id = $1 AND r.cost_id = $2 AND r.id = $3`,
    [household.id, costId, receiptId],
  );
  if (!found) fail('not_found');
  const etag = `"${found.sha256 as string}"`;
  if (notModified(ctx, etag)) return { status: 304, headers: { ETag: etag } };
  let body: Buffer | null;
  try {
    body = await getObject(receiptKey(household.id, receiptId));
  } catch (error) {
    if (error instanceof StorageUnavailable) fail('storage_unavailable');
    throw error;
  }
  if (!body) fail('not_found');
  const filename = found.filename as string;
  return {
    status: 200,
    body,
    headers: {
      ETag: etag,
      'Content-Type': found.content_type as string,
      'Content-Disposition':
        `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  };
}
