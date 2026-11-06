import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import { ERR, asyncRoute } from '../errors';
import type { AppServices } from '../session';
import { DOWNLOAD_ROLES } from '../../shared/permissions';
import type { Role } from '../../shared/domain';
import { writeAuditRow } from '../audit';
import { lockGraph, authorityFor } from './tags';

interface MergedRange {
  start: number;
  end: number;
}

/** GET and HEAD /api/assets/{id}/evidence (DP-52, DP-53, DP-54). */
export function evidenceRoutes(svc: AppServices) {
  const handler = asyncRoute(async (req: Request, res: Response) => {
    const assetId = String(req.params.id);
    const isHead = req.method === 'HEAD';
    const asset = await svc.db.queryOne<{ id: string; state: string }>(`SELECT id, state FROM assets WHERE id = $1`, [assetId]);
    if (!asset) throw ERR.notFound();
    const record = await svc.db.queryOne<{
      evidence_id: string;
      filename: string;
      content_type: string;
      size_bytes: string;
      sha256: string;
      object_key: string;
      uploaded_at: string;
      uploaded_by: string;
    }>(`SELECT evidence_id, filename, content_type, size_bytes, sha256, object_key, uploaded_at, uploaded_by FROM evidence WHERE asset = $1`, [
      assetId,
    ]);
    if (!record) throw ERR.notFound();
    if (!(DOWNLOAD_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();

    const size = Number(record.size_bytes);
    const etag = `"${record.sha256}"`;
    res.setHeader('Cache-Control', 'private, no-store');

    // If-None-Match, decided from the recorded sha256 before the store is contacted.
    const inm = req.headers['if-none-match'];
    if (inm !== undefined && matchesEtag(inm, record.sha256)) {
      res.setHeader('ETag', etag);
      res.status(304).end();
      return;
    }

    // Range syntax: used only for a well-formed bytes header with 1..10 specs.
    const rangeHeader = req.headers.range;
    let ranges: MergedRange[] | null = null;
    if (rangeHeader !== undefined) {
      const parsed = parseRange(rangeHeader, size);
      ranges = parsed;
      if (parsed !== null && parsed.length === 0) {
        res.setHeader('Content-Range', `bytes */${size}`);
        res.status(416).json({ error: { code: 'range_not_satisfiable', message: 'Requested range is outside the evidence file.' } });
        return;
      }
    }

    // If-Range: the range is honoured only for a strong matching tag.
    if (ranges !== null && req.headers['if-range'] !== undefined) {
      const ir = String(req.headers['if-range']);
      if (ir !== etag) ranges = null;
    }

    const commonHeaders = () => {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('ETag', etag);
      res.setHeader('Content-Disposition', contentDisposition(record.filename));
    };

    // A 200 or 206 needs the store.
    const bytes = await svc.evidence.getBytes(record.object_key).catch(() => null);
    if (bytes === null || bytes.length !== size) {
      svc.evidence.available = false;
      throw ERR.unavailable(
        'evidence_unavailable',
        'Evidence storage is unreachable. The asset stays in draft; try again shortly.'
      );
    }

    // One audit row per delivered download, committed before its first byte.
    // HEAD answers the same status and headers but writes no row (DP-10).
    const rangeLog = ranges !== null ? ranges.map((r) => `${r.start}-${r.end}`).join(',') : null;
    if (!isHead) {
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, DOWNLOAD_ROLES as readonly Role[]);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'evidence.download',
          targetType: 'asset',
          targetId: assetId,
          before: null,
          after: { evidence_sha256: record.sha256, range: rangeLog },
        });
      });
    }

    if (ranges === null) {
      commonHeaders();
      res.setHeader('Content-Type', record.content_type);
      res.setHeader('Content-Length', String(size));
      res.status(200);
      if (isHead) res.end();
      else res.end(bytes);
      return;
    }
    if (ranges.length === 1) {
      const r = ranges[0]!;
      commonHeaders();
      res.setHeader('Content-Type', record.content_type);
      res.setHeader('Content-Range', `bytes ${r.start}-${r.end}/${size}`);
      res.setHeader('Content-Length', String(r.end - r.start + 1));
      res.status(206);
      if (isHead) res.end();
      else res.end(bytes.subarray(r.start, r.end + 1));
      return;
    }
    const boundary = boundaryToken();
    const parts: Buffer[] = [];
    for (const r of ranges) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Type: ${record.content_type}\r\nContent-Range: bytes ${r.start}-${r.end}/${size}\r\n\r\n`
        ),
        bytes.subarray(r.start, r.end + 1),
        Buffer.from('\r\n')
      );
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    commonHeaders();
    res.setHeader('Content-Type', `multipart/byteranges; boundary=${boundary}`);
    res.setHeader('Content-Length', String(body.length));
    res.status(206);
    if (isHead) res.end();
    else res.end(body);
  });

  return { handler };
}

function matchesEtag(header: string | string[], sha256: string): boolean {
  const value = Array.isArray(header) ? header.join(', ') : header;
  if (value.trim() === '*') return true;
  return value
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//i, ''))
    .some((tag) => tag === `"${sha256}"`);
}

/**
 * Range evaluation (DP-52, DP-53): null means the header is ignored (a 200
 * with the full body); an empty array means 416.
 */
function parseRange(header: string, size: number): MergedRange[] | null {
  const m = /^bytes\s*=\s*(.+)$/i.exec(header.trim());
  if (!m) return null;
  const specs = m[1]!.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (specs.length < 1 || specs.length > 10) return null;
  const resolved: MergedRange[] = [];
  for (const spec of specs) {
      if (spec === '-0') return [];
    const suffix = /^-(\d+)$/.exec(spec);
    const fromTo = /^(\d+)-(\d+)$/.exec(spec);
    const openEnd = /^(\d+)-$/.exec(spec);
    if (suffix) {
      const n = Number(suffix[1]);
      if (n === 0) return [];
      const start = Math.max(0, size - n);
      if (start >= size) continue; // unsatisfiable, dropped
      resolved.push({ start, end: size - 1 });
    } else if (fromTo) {
      const a = Number(fromTo[1]);
      const b = Number(fromTo[2]);
      if (a > b) return null; // malformed, header ignored
      if (a >= size) continue; // unsatisfiable, dropped
      resolved.push({ start: a, end: Math.min(b, size - 1) });
    } else if (openEnd) {
      const a = Number(openEnd[1]);
      if (a >= size) continue;
      resolved.push({ start: a, end: size - 1 });
    } else {
      return null; // malformed, header ignored
    }
  }
  resolved.sort((x, y) => x.start - y.start);
  const merged: MergedRange[] = [];
  for (const r of resolved) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

function contentDisposition(filename: string): string {
  const ascii = [...filename]
    .map((ch) => (/^[\x20-\x7E]$/.test(ch) && ch !== '"' && ch !== '\\' ? ch : '_'))
    .join('');
  const encoded = [...filename]
    .map((ch) => {
      if (/^[A-Za-z0-9!#$&+.^_`|~]$/.test(ch)) return ch;
      return Buffer.from(ch, 'utf-8')
        .toString('hex')
        .replace(/(..)/g, '%$1')
        .toUpperCase();
    })
    .join('');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function boundaryToken(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  const bytes = createHash('sha256').update(String(process.pid) + String(Date.now()) + String(Math.random())).digest();
  const len = 16 + (bytes[0]! % 55);
  for (let i = 0; i < len; i++) token += alphabet[bytes[(i * 7 + 1) % bytes.length]! % alphabet.length];
  return token;
}
