import type { IncomingMessage, ServerResponse } from 'node:http';
import { INVALID_BODY_MESSAGE, TAKEN_MESSAGE, WRONG_CREDENTIALS_MESSAGE } from '../shared/messages.js';
import type { ConflictBody, LayoutObject } from '../shared/types.js';
import { Refusal } from './domain/refusal.js';

export const BODY_LIMIT = 65_536;

/** An answer with a status and a JSON body, thrown to end a handler early. */
class Answer extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Record<string, string> = {},
  ) {
    super(`answer ${status}`);
  }
}

/** Every API error body is built here: `error`, plus `message` for the refusals that carry one. */
const failure = (status: number, error: string, message?: string): Answer => new Answer(status, message === undefined ? { error } : { error, message });

export const notFound = (): Answer => failure(404, 'not_found');
export const signInRequired = (): Answer => failure(401, 'sign_in_required');
export const starting = (): Answer => failure(503, 'starting');
export const taken = (): Answer => failure(409, 'taken', TAKEN_MESSAGE);
export const wrongCredentials = (): Answer => failure(401, 'wrong_credentials', WRONG_CREDENTIALS_MESSAGE);
export const noViewLink = (): Answer => failure(409, 'no_view_link');
export const tooLarge = (): Answer => new Answer(413, { error: 'too_large' }, { Connection: 'close' });
export const conflictAnswer = (layout: LayoutObject, message: string): Answer => {
  const body: ConflictBody = { error: 'conflict', revision: layout.revision, layout, message };
  return new Answer(409, body);
};

/** The answer for anything thrown while handling a request. */
export function answerFor(error: unknown): Answer {
  if (error instanceof Answer) return error;
  if (error instanceof Refusal) return failure(422, 'invalid', error.message);
  console.error(error);
  return failure(500, 'server_error');
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function respond(response: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  response.writeHead(status, { ...SECURITY_HEADERS, ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), ...headers });
  response.end(payload);
}

export function respondFile(response: ServerResponse, status: number, contentType: string, content: Buffer, cache: string): void {
  response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': contentType, 'Cache-Control': cache });
  response.end(content);
}

/** The request body, or `null` when it is over the limit (the rest is not read). */
export function readBody(request: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        request.removeAllListeners('data');
        request.pause();
        resolve(null);
      } else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/** The body as JSON; anything else is the published invalid-body refusal. */
export function jsonOf(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new Refusal(INVALID_BODY_MESSAGE);
  }
}
