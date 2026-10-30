import { errors, envelope, sendError } from '../lib/http.js';
import { tokenFromRequest } from '../lib/session.js';

const BODY_LIMIT = 1000000;

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function readBody(req) {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length'] || 0);
    const chunks = [];
    let size = 0;
    let tooLarge = declared > BODY_LIMIT;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve({ tooLarge, buffer: Buffer.concat(chunks) });
    };
    req.on('data', (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > BODY_LIMIT) {
        tooLarge = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', finish);
    req.on('error', finish);
  });
}

export function jsonContentTypeOk(req) {
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return ct === 'application/json';
}

export function requireAppIdHeader(req) {
  const appId = req.headers['x-corvo-org'];
  if (!appId) throw errors.appIdRequired();
  return appId;
}

export function requireCredential(req, cookies) {
  const token = tokenFromRequest(req, cookies);
  if (!token) throw errors.unauthenticated();
  return token;
}

// Connection-level Postgres failures map to the outage code.
export function isDbError(err) {
  if (!err) return false;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', '57P01', '53300', '08006', '08003'].includes(err.code)) return true;
  return /terminating connection|connection terminated|Connection terminated unexpectedly|server closed the connection|timeout exceeded when trying to connect/i.test(err.message || '');
}
