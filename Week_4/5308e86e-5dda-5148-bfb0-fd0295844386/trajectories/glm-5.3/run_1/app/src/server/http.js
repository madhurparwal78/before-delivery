// One error shape for every API answer. Nothing here reveals SQL, stack
// traces, constraint names, file paths or the database's name.
export class ApiError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
  body() {
    return { error: this.code, ...this.extra };
  }
}

export const errUnauthorized = () => new ApiError(401, 'unauthorized');
export const errForbidden = () => new ApiError(403, 'forbidden');
export const errNotFound = () => new ApiError(404, 'not_found');
export const errMethodNotAllowed = (allow) => new ApiError(405, 'method_not_allowed', { __allow: allow });
export const errPayloadTooLarge = () => new ApiError(413, 'payload_too_large');
export const errUnsupportedMediaType = () => new ApiError(415, 'unsupported_media_type');
export const errInternal = () => new ApiError(500, 'internal');
export const errServiceUnavailable = () => new ApiError(503, 'service_unavailable');
export const errValidation = (fields) => new ApiError(400, 'validation', { fields });
export const errInvalidJson = () => new ApiError(400, 'invalid_json');

export function sendError(res, e, allowHeader) {
  const err = e instanceof ApiError ? e : errInternal();
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (err.code === 'method_not_allowed' && err.extra.__allow) headers.Allow = err.extra.__allow;
  if (err.status === 503) headers['Retry-After'] = '1';
  const body = JSON.stringify(err.body());
  res.writeHead(err.status, headers);
  res.end(body);
}

export function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

export function readBody(req, capBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    req.on('data', (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > capBytes) {
        over = true;
        // Keep reading and discard so the client sees the answer instead of a
        // hard reset, then answer 413.
        chunks.length = 0;
        finish(reject, errPayloadTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) return;
      finish(resolve, Buffer.concat(chunks));
    });
    req.on('error', () => {
      if (!over) finish(reject, errInternal());
    });
    if (Number(req.headers['content-length'] || 0) > capBytes) {
      over = true;
      finish(reject, errPayloadTooLarge());
    }
  });
}

export function parseJsonBody(raw) {
  if (raw.length === 0) return {};
  if (!isValidUtf8(raw)) throw errInvalidJson();
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw errInvalidJson();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw errInvalidJson();
  }
  return parsed;
}

// Strict UTF-8 validation so a body that is not valid UTF-8 answers
// invalid_json rather than silently becoming U+FFFD.
export function isValidUtf8(buf) {
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const b = buf[i];
    if (b < 0x80) { i++; continue; }
    if (b >= 0xc2 && b <= 0xdf) {
      if (i + 1 >= n || (buf[i+1] & 0xc0) !== 0x80) return false;
      i += 2; continue;
    }
    if (b >= 0xe0 && b <= 0xef) {
      if (b === 0xe0 && (i + 1 >= n || buf[i+1] < 0xa0)) return false;
      if (b === 0xed && (i + 1 >= n || buf[i+1] > 0x9f)) return false;
      if (i + 2 >= n || (buf[i+1] & 0xc0) !== 0x80 || (buf[i+2] & 0xc0) !== 0x80) return false;
      i += 3; continue;
    }
    if (b >= 0xf0 && b <= 0xf4) {
      if (b === 0xf0 && (i + 1 >= n || buf[i+1] < 0x90)) return false;
      if (b === 0xf4 && (i + 1 >= n || buf[i+1] > 0x8f)) return false;
      if (i + 3 >= n || (buf[i+1] & 0xc0) !== 0x80 || (buf[i+2] & 0xc0) !== 0x80 || (buf[i+3] & 0xc0) !== 0x80) return false;
      i += 4; continue;
    }
    return false;
  }
  return true;
}

export function contentTypeIsJson(req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const media = ct.split(';')[0].trim();
  return media === 'application/json';
}
