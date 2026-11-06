import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { appendAudit, reserveSeq } from '../commit.ts';
import { withCommitOrder, withReadTransaction } from '../db.ts';
import {
  type ByteRange,
  contentDisposition,
  evaluateRange,
  matchesIfNoneMatch,
  rangeAuditValue,
} from '../domain/evidence.ts';
import { allows } from '../domain/roles.ts';
import { loadCurrentSnapshot } from '../domain/snapshot.ts';
import type { EvidenceRecord } from '../domain/snapshot.ts';
import type { Ctx, Reply } from '../http/context.ts';
import { errors } from '../http/errors.ts';
import type { Router } from '../http/router.ts';
import { EvidenceStoreUnavailable, evidenceStore } from '../services/storage.ts';
import { markEvidenceDown } from '../services/status.ts';

interface MultipartPlan {
  boundary: string;
  parts: { range: ByteRange; header: Buffer }[];
  closing: Buffer;
  contentLength: number;
}

function multipartPlan(ranges: readonly ByteRange[], contentType: string, size: number): MultipartPlan {
  const boundary = randomBytes(16).toString('hex');
  const parts = ranges.map((range) => ({
    range,
    header: Buffer.from(
      `--${boundary}\r\nContent-Type: ${contentType}\r\n` +
        `Content-Range: bytes ${range.start}-${range.end}/${size}\r\n\r\n`,
      'utf8',
    ),
  }));
  const closing = Buffer.from(`--${boundary}--\r\n`, 'utf8');
  const contentLength =
    parts.reduce(
      (total, part) => total + part.header.length + (part.range.end - part.range.start + 1) + 2,
      0,
    ) + closing.length;
  return { boundary, parts, closing, contentLength };
}

async function streamRange(
  response: ServerResponse,
  storageKey: string,
  range: ByteRange,
): Promise<void> {
  const source = await evidenceStore.getRange(storageKey, range.start, range.end);
  // An aborted download releases its store stream at once.
  const release = (): void => {
    source.destroy();
  };
  response.once('close', release);
  await new Promise<void>((resolve, reject) => {
    source.on('error', reject);
    source.on('end', resolve);
    source.on('data', (chunk: Buffer) => {
      if (!response.write(chunk)) {
        source.pause();
        response.once('drain', () => source.resume());
      }
    });
  }).catch(() => undefined);
  response.off('close', release);
  source.destroy();
}

export function registerEvidenceDownloadRoutes(router: Router): void {
  const handler = async (ctx: Ctx): Promise<Reply | null> => {
    const actor = await ctx.requireActor();
    const assetId = ctx.params.id;
    const evidence = await withReadTransaction(async (client) => {
      const asset = await client.query('SELECT 1 FROM assets WHERE id = $1', [assetId]);
      if ((asset.rowCount ?? 0) === 0) throw errors.notFound();
      const snapshot = await loadCurrentSnapshot(client);
      return snapshot.assets.get(assetId)?.evidence ?? null;
    });
    if (evidence === null) throw errors.notFound();
    if (!allows(actor.role, 'evidence.download')) throw errors.forbidden();

    const record: EvidenceRecord = evidence;
    const etag = `"${record.sha256}"`;
    const baseHeaders: Record<string, string> = { 'Cache-Control': 'private, no-store' };
    const isHead = ctx.method === 'HEAD';

    if (matchesIfNoneMatch(ctx.header('if-none-match'), etag)) {
      return { status: 304, headers: { ...baseHeaders, ETag: etag } };
    }

    const outcome = evaluateRange(
      ctx.header('range'),
      ctx.header('if-range'),
      etag,
      record.sizeBytes,
    );
    if (outcome.kind === 'unsatisfiable') {
      return {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${record.sizeBytes}` },
        json: errors.rangeNotSatisfiable().body(),
      };
    }

    const ranges: ByteRange[] | null =
      outcome.kind === 'ranges' ? outcome.ranges : null;
    const single = ranges !== null && ranges.length === 1 ? ranges[0] : null;
    const plan =
      ranges !== null && ranges.length > 1
        ? multipartPlan(ranges, record.contentType, record.sizeBytes)
        : null;

    const headers: Record<string, string> = {
      ...baseHeaders,
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Content-Disposition': contentDisposition(record.filename),
    };
    let status = 200;
    if (single !== null) {
      status = 206;
      headers['Content-Type'] = record.contentType;
      headers['Content-Range'] = `bytes ${single.start}-${single.end}/${record.sizeBytes}`;
      headers['Content-Length'] = String(single.end - single.start + 1);
    } else if (plan !== null) {
      status = 206;
      headers['Content-Type'] = `multipart/byteranges; boundary=${plan.boundary}`;
      headers['Content-Length'] = String(plan.contentLength);
    } else {
      headers['Content-Type'] = record.contentType;
      headers['Content-Length'] = String(record.sizeBytes);
    }

    if (isHead) return { status, headers };

    // Confirm the object exists, commit the access row, and only then start streaming.
    try {
      if (!(await evidenceStore.exists(record.storageKey))) throw errors.notFound();
    } catch (error) {
      if (error instanceof EvidenceStoreUnavailable) {
        markEvidenceDown();
        throw errors.evidenceUnavailable();
      }
      throw error;
    }
    await withCommitOrder(async (client) => {
      const seq = await reserveSeq(client);
      await appendAudit(client, seq, {
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'evidence.download',
        targetType: 'asset',
        targetId: assetId,
        before: null,
        after: { evidence_sha256: record.sha256, range: rangeAuditValue(ranges) },
      });
    });

    ctx.response.writeHead(status, headers);
    try {
      if (plan !== null) {
        for (const part of plan.parts) {
          ctx.response.write(part.header);
          await streamRange(ctx.response, record.storageKey, part.range);
          ctx.response.write('\r\n');
        }
        ctx.response.write(plan.closing);
      } else {
        const whole = single ?? { start: 0, end: Math.max(0, record.sizeBytes - 1) };
        await streamRange(ctx.response, record.storageKey, whole);
      }
    } finally {
      ctx.response.end();
    }
    return null;
  };

  router.add('GET', '/api/assets/:id/evidence', handler);
  router.add('HEAD', '/api/assets/:id/evidence', handler);
}
