import type { NextFunction, Request, Response } from 'express';
import { Refusal, refuse } from '../domain/errors';

export const JSON_BODY_LIMIT = 65_536;
export const CAPTURE_BODY_LIMIT = 262_144;
export const UPLOAD_REQUEST_LIMIT = 8_200_000;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The browser talks only to this origin. */
export const originGuard = (request: Request, response: Response, next: NextFunction): void => {
  const origin = request.headers.origin;
  if (origin === undefined || !STATE_CHANGING.has(request.method)) {
    next();
    return;
  }
  const host = request.headers.host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    response.status(403).json({ error: 'cross_origin', message: 'That request came from another origin' });
    return;
  }
  if (host === undefined || originHost !== host) {
    response.status(403).json({ error: 'cross_origin', message: 'That request came from another origin' });
    return;
  }
  next();
};

/**
 * Reads a body up to its limit. An oversized body stops being read and is answered,
 * rather than having its connection dropped, so the caller still gets its refusal.
 */
const readRaw = (request: Request, limit: number, tooLarge: () => Refusal): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > limit) {
      request.pause();
      reject(tooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > limit) {
        settled = true;
        request.pause();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });

const bodyTooLarge = (): Refusal => refuse(413, 'body_too_large', 'That request body is too large');

/**
 * Reads and parses a JSON body under its published limit. Oversized bodies and wrong
 * content types are refused before anything else is checked.
 */
export const jsonBody = (limitFor: number | ((request: Request) => number)) =>
  async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    if (!STATE_CHANGING.has(request.method)) {
      next();
      return;
    }
    try {
      const limit = typeof limitFor === 'number' ? limitFor : limitFor(request);
      const raw = await readRaw(request, limit, bodyTooLarge);
      if (raw.length === 0) {
        request.body = undefined;
        next();
        return;
      }
      const contentType = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        next(refuse(415, 'unsupported_media_type', 'Send this route application/json'));
        return;
      }
      try {
        request.body = JSON.parse(raw.toString('utf8')) as unknown;
      } catch {
        next(refuse(422, 'validation', 'That body is not valid JSON'));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };

/** The upload route takes a whole request of up to 8,200,000 bytes. */
export const uploadRequestGuard = (request: Request, _response: Response, next: NextFunction): void => {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > UPLOAD_REQUEST_LIMIT) {
    next(refuse(413, 'file_too_large', 'This file is over the size limit'));
    return;
  }
  const contentType = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'multipart/form-data') {
    next(refuse(415, 'unsupported_media_type', 'Send this route multipart/form-data'));
    return;
  }
  next();
};

export const errorHandler = (
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof Refusal) {
    response.status(error.status).json(error.body);
    return;
  }
  console.error('Unhandled failure', error);
  response.status(500).json({ error: 'server_failure', message: 'Something went wrong on the server' });
};
