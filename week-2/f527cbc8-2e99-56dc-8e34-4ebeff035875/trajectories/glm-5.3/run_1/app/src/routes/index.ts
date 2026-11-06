import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Caller } from '../context.js';
import { AppError, Handled } from '../errors.js';
import { tokenAllowsFarrierGet } from '../roles.js';
import { send, send204 } from '../respond.js';
import { vetGuessCheck, addressVetAllowance } from './vet.js';

/**
 * API entry point. Applies the shared error precedence then dispatches to the
 * route table.
 */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string,
  address: string,
  caller: Caller | null
): Promise<number> {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = url.pathname;

  // Vet read-only paths (error precedence steps 2-3).
  if (path.startsWith('/api/vet/') || path === '/api/vet') {
    if (method !== 'GET') throw new AppError(405, 'read_only');
    const limit = await vetGuessCheck(address);
    if (limit.limited) {
      send(res, requestId, 429, { error: 'rate_limited' }, { 'Retry-After': String(limit.retryAfter), ...limit.headers });
      return 429;
    }
    if (path === '/api/vet' || !path.startsWith('/api/vet/')) throw new AppError(404, 'not_found');
    const { serveVetToken } = await import('./vet.js');
    const status = await serveVetToken(req, res, url, requestId, address, caller);
    return status;
  }

  if (caller && caller.type === 'token' && !tokenAllowsFarrierGet(caller, path)) {
    throw new AppError(403, 'insufficient_scope');
  }
  const { route } = await import('./table.js');
  const result = await route(req, res, url, requestId, address, caller);
  return result;
}
