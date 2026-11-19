import { Router } from 'express';
import { query } from '../db.js';
import { ApiError, errors, newId } from '../errors.js';
import { config } from '../config.js';
import { businessMs } from '../clock.js';
import { wrap, requireSession } from '../http.js';
import { getMember, getMemberById, projectProfile, personCard } from '../profile.js';
import { blockedWith, mutuals, connectionEdges, adjacencyFor, shortestPath } from '../graph.js';
import { findPair, stateBetween } from '../connections.js';
import { putObject } from '../s3.js';
import Busboy from 'busboy';
import type { Request, Response } from 'express';

const MENTION_RE = /(^|\s)@([a-z0-9-]{3,30})/g;
const HASHTAG_RE = /(^|\s)#([A-Za-z0-9_]{1,50})/g;

export { MENTION_RE, HASHTAG_RE };

const parseMultipart = (req: Request, maxBytes: number): Promise<{ file: Buffer; declaredType: string }> =>
  new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: maxBytes + 65536 } });
    let file: Buffer[] = [];
    let declaredType = '';
    let size = 0;
    let tooLarge = false;
    busboy.on('file', (_name, stream, info) => {
      declaredType = info.mimeType;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { tooLarge = true; return; }
        file.push(chunk);
      });
      stream.on('limit', () => { tooLarge = true; });
      stream.on('end', () => {
        if (tooLarge) reject({ tooLarge: true });
        else resolve({ file: Buffer.concat(file), declaredType });
      });
    });
    busboy.on('error', () => reject({ tooLarge: false }));
    req.pipe(busboy);
  });

const jpegKind = (buf: Buffer): 'jpeg' | 'png' | null => {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
};

/** Strip JPEG APPn/comment segments and PNG text chunks; keep the pixels identical. */
const stripMetadata = (buf: Buffer, kind: 'jpeg' | 'png'): Buffer => {
  if (kind === 'jpeg') return stripJpeg(buf);
  return stripPng(buf);
};

const stripJpeg = (buf: Buffer): Buffer => {
  const out: Buffer[] = [];
  let i = 0;
  out.push(buf.subarray(0, 2));
  i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { out.push(buf.subarray(i)); break; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    if (marker === 0x01 || marker === 0xd9) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    // APP1..APP15 (0xe1..0xef) and COM (0xfe) are metadata.
    if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) { i += 2 + len; continue; }
    out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return Buffer.concat(out);
};

const stripPng = (buf: Buffer): Buffer => {
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('ascii');
    const total = 12 + len;
    if (type === 'IEND') { out.push(buf.subarray(i, i + total)); break; }
    if (drop.has(type)) { i += total; continue; }
    out.push(buf.subarray(i, i + total));
    i += total;
  }
  return Buffer.concat(out);
};

const uploadPhoto = async (req: Request, res: Response): Promise<void> => {
  const viewerId = req.auth!.memberId;
  let parsed: Awaited<ReturnType<typeof parseMultipart>>;
  try {
    parsed = await parseMultipart(req, config.photoMaxBytes);
  } catch (e: unknown) {
    const err = e as { tooLarge?: boolean };
    if (err.tooLarge) throw new ApiError(422, { error: 'photo_too_large', limit: config.photoMaxBytes });
    throw new ApiError(422, { error: 'photo_type' });
  }
  const kind = jpegKind(parsed.file);
  if (!kind) throw new ApiError(422, { error: 'photo_type' });
  if (parsed.file.length > config.photoMaxBytes) throw new ApiError(422, { error: 'photo_too_large', limit: config.photoMaxBytes });
  const clean = stripMetadata(parsed.file, kind);
  const photoId = newId();
  const key = `photos/${photoId}.${kind}`;
  const ok = await putObject(key, clean).catch(() => false);
  if (!ok) throw errors.storageUnavailable();
  await query(
    `INSERT INTO uploads (id, kind, owner_id, content_type, bytes, created_at)
     VALUES ($1, 'photo', $2, $3, $4, $5)`,
    [photoId, viewerId, kind === 'jpeg' ? 'image/jpeg' : 'image/png', clean.length, new Date(businessMs())]);
  res.status(201).json({ photo_id: photoId, url: `/media/photos/${photoId}`, bytes: clean.length, content_type: kind === 'jpeg' ? 'image/jpeg' : 'image/png' });
};


export const profilesRouter = (): Router => {
  const router = Router();
  router.use('/profiles', requireSession);
  router.use('/uploads/photo', requireSession);

  router.post('/uploads/photo', wrap(async (req, res) => { await uploadPhoto(req, res); }));

  router.get('/profiles/:handle', wrap(async (req, res) => {
    const member = await getMember(req.params.handle);
    if (!member) throw errors.notFound();
    const projection = await projectProfile(req.auth!.memberId, member);
    if (!projection) throw errors.notFound();
    res.json(projection);
  }));

  router.get('/profiles/:handle/mutual', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const member = await getMember(req.params.handle);
    if (!member) throw errors.notFound();
    const blocked = await blockedWith(viewerId);
    if (blocked.has(member.id)) throw errors.notFound();
    const projection = await projectProfile(viewerId, member);
    if (!projection) throw errors.notFound();
    const list = await mutuals(viewerId, member.id, blocked);
    const cards = [];
    for (const m of list) {
      const full = await getMemberById(m.id);
      if (!full) continue;
      cards.push(await personCard(viewerId, full));
    }
    res.json({ count: cards.length, members: cards });
  }));

  router.get('/profiles/:handle/path', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const member = await getMember(req.params.handle);
    if (!member) throw errors.notFound();
    const blocked = await blockedWith(viewerId);
    if (blocked.has(member.id)) throw errors.notFound();
    const projection = await projectProfile(viewerId, member);
    if (!projection) throw errors.notFound();
    const edges = await connectionEdges();
    const adj = adjacencyFor(edges, blocked);
    const names = new Map<string, { name: string; id: string }>();
    const result = await query<{ id: string; name: string }>(`SELECT id, name FROM members`);
    for (const row of result.rows) names.set(row.id, { id: row.id, name: row.name });
    const pathIds = shortestPath(viewerId, member.id, adj, names);
    const path: unknown[] = [];
    if (pathIds) {
      for (const id of pathIds) {
        const m = names.get(id);
        if (!m) continue;
        const full = await getMemberById(id);
        const visibleToViewer = full ? await visibleAtAll(viewerId, full, blocked) : false;
        path.push(visibleToViewer && full
          ? { id: full.id, name: full.name, handle: full.handle }
          : { private: true });
      }
    }
    res.json({ path });
  }));

  return router;
};

const visibleAtAll = async (viewerId: string, member: NonNullable<Awaited<ReturnType<typeof getMemberById>>>, blocked: Set<string>): Promise<boolean> => {
  if (member.visibility === 'private') {
    const row = await findPair(viewerId, member.id);
    return stateBetween(viewerId, row, false) === 'connected';
  }
  return !blocked.has(member.id);
};
