import type { IncomingMessage, ServerResponse } from 'node:http';
import { connectDb, withTx } from '../db.js';
import { verifyPhotoPath } from '../photourls.js';
import { getObject } from '../storage.js';
import { send } from '../respond.js';
import { now } from '../time.js';

/** Signed media paths under /media/ (Photo URLs, DP-99, DP-73). */
export async function serveMedia(req: IncomingMessage, res: ServerResponse, url: URL, requestId: string): Promise<void> {
  const parts = url.pathname.slice('/media/'.length).split('/');
  const photoId = decodeURIComponent(parts[0] ?? '');
  const thumb = parts[1] === 'thumb';
  const k = url.searchParams.get('k') ?? '';
  const exp = url.searchParams.get('exp') ?? '';
  const sig = url.searchParams.get('sig') ?? '';
  const v = url.searchParams.get('v');

  const verdict = await verifyPhotoPath(photoId, thumb, k, exp, sig, v);
  if (verdict !== 'ok') {
    send(res, requestId, 403, { error: 'url_invalid' });
    return;
  }

  // Vet paths verify only while their link is live and the photo is in the live pair.
  if (v !== null) {
    const ok = await vetPhotoAllowed(photoId, v);
    if (!ok) {
      send(res, requestId, 403, { error: 'url_invalid' });
      return;
    }
  }

  const rows = await connectDb().query(`select storage_key, content_type from photos where id = $1`, [photoId]);
  if (rows.rows.length === 0) {
    send(res, requestId, 404, { error: 'not_found' });
    return;
  }
  const key = thumb ? `${rows.rows[0].storage_key}.thumb.jpg` : rows.rows[0].storage_key;
  const data = await getObject(key);
  if (data === null) {
    send(res, requestId, 404, { error: 'not_found' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': thumb ? 'image/jpeg' : rows.rows[0].content_type,
    'Content-Length': String(data.length),
    'X-Request-Id': requestId,
    'Cache-Control': 'private, max-age=60'
  });
  res.end(data);
}

async function vetPhotoAllowed(photoId: string, vetLinkId: string): Promise<boolean> {
  const rows = await connectDb().query(
    `select vl.status, vl.expires_at from vet_links vl where vl.id = $1`,
    [vetLinkId]
  );
  if (rows.rows.length === 0) return false;
  const link = rows.rows[0];
  if (link.status !== 'active' || link.expires_at.getTime() <= now().getTime()) return false;
  const pair = await connectDb().query(
    `select v.id as visit_id from visits v join vet_links vl on vl.horse_id = v.horse_id
     where vl.id = $1 and v.status <> 'open' order by v.business_date desc, v.id desc limit 2`,
    [vetLinkId]
  );
  const allowed = new Set<string>();
  for (const v of pair.rows) {
    const photos = await connectDb().query(
      `select id from photos where visit_id = $1 and phase = 'after'`,
      [v.visit_id]
    );
    for (const p of photos.rows) allowed.add(p.id);
  }
  return allowed.has(photoId);
}
