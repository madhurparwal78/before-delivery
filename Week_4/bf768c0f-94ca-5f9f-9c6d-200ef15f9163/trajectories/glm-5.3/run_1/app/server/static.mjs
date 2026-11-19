// Static files: the built bundle, vendored media, uploaded avatars.
import fs from 'node:fs';
import path from 'node:path';
import { query } from '../lib/db.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function serveStatic(req, res, pathname) {
  // never serve anything outside the dist root
  const tryRoots = [DIST];
  const rel = pathname.replace(/^\/+/, '');
  for (const root of tryRoots) {
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) continue;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const ext = path.extname(file).toLowerCase();
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(data);
    return true;
  }
  return false;
}

// Uploaded avatars are served from the store as 256x256 PNGs.
export async function mediaHandler(req, res, pathname) {
  const m = pathname.match(/^\/media\/avatars\/([^/.]+)\.png$/);
  if (!m) return false;
  const id = decodeURIComponent(m[1]);
  const r = await query('SELECT data FROM avatars WHERE member_id = $1', [id]);
  if (r.rowCount === 0) return false;
  res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': r.rows[0].data.length });
  res.end(r.rows[0].data);
  return true;
}
