import { currentViewer } from '../auth.js';
import { one } from '../db.js';
import { errors } from '../errors.js';
import { canReadMedia } from '../domain/mediaAccess.js';
import { mediaExtensions, type MediaType } from '../domain/media.js';
import type { HttpResponse, RequestContext } from '../http/context.js';
import type { Router } from '../http/router.js';
import { getObject } from '../services/storage.js';

interface MediaRow {
  id: string;
  workspace_id: string;
  object_key: string;
  content_type: MediaType;
}

async function serveMedia(context: RequestContext): Promise<HttpResponse> {
  const id = context.params.id;
  const reference = await one<MediaRow>(
    'select id, workspace_id, object_key, content_type from refs where id = $1',
    [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null],
  );
  if (reference === null) {
    throw errors.notFound();
  }
  const viewer = await currentViewer(context);
  const reviewToken = context.url.searchParams.get('review');
  if (!(await canReadMedia(reference, viewer, reviewToken, new Date()))) {
    throw errors.notFound();
  }
  const stored = await getObject(reference.object_key);
  if (stored === null) {
    throw errors.notFound();
  }
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${reference.id}.${mediaExtensions[reference.content_type]}"`,
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'Accept-Ranges': 'bytes',
  };

  // Browsers only scrub a clip when the media is served as a byte range.
  const range = requestedRange(context.headers.range, stored.bytes.length);
  if (range === null) {
    return { status: 200, body: stored.bytes, contentType: reference.content_type, headers };
  }
  return {
    status: 206,
    body: stored.bytes.subarray(range.start, range.end + 1),
    contentType: reference.content_type,
    headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${stored.bytes.length}` },
  };
}

interface ByteRange {
  start: number;
  end: number;
}

function requestedRange(header: string | string[] | undefined, length: number): ByteRange | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === '' && match[2] === '')) {
    return null;
  }
  if (match[1] === '') {
    const suffix = Math.min(length, Number(match[2]));
    return { start: length - suffix, end: length - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? length - 1 : Math.min(length - 1, Number(match[2]));
  if (start > end || start >= length) {
    return null;
  }
  return { start, end };
}

export function registerMediaRoutes(router: Router): void {
  router.get('/media/:id', serveMedia);
}
