import { AppError } from '../errors.js';
import { tokenAllowsFarrierGet } from '../roles.js';
import { send } from '../respond.js';
import { vetGuessCheck } from './vet.js';
export async function handleApi(req, res, url, requestId, address, caller) {
    const method = (req.method ?? 'GET').toUpperCase();
    const path = url.pathname;
    if (path.startsWith('/api/vet/') || path === '/api/vet') {
        if (method !== 'GET')
            throw new AppError(405, 'read_only');
        const limit = await vetGuessCheck(address);
        if (limit.limited) {
            send(res, requestId, 429, { error: 'rate_limited' }, { 'Retry-After': String(limit.retryAfter), ...limit.headers });
            return 429;
        }
        if (path === '/api/vet' || !path.startsWith('/api/vet/'))
            throw new AppError(404, 'not_found');
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
