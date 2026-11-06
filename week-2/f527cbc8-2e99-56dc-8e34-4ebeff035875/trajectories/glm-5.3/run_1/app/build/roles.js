import { AppError } from './errors.js';
export function requireRole(caller, roles) {
    if (!caller)
        throw new AppError(401, 'unauthenticated');
    if (caller.type === 'token') {
        if (roles.includes('token'))
            return;
        if (roles.includes('farrier'))
            return;
        throw new AppError(403, 'insufficient_scope');
    }
    if (roles.includes(caller.role))
        return;
    throw new AppError(403, 'forbidden');
}
export function requireTokenScope(caller, need) {
    if (!caller)
        throw new AppError(401, 'unauthenticated');
    if (caller.type === 'token') {
        if (caller.scope === 'billing' || (caller.scope === 'read_only' && need === 'read_only'))
            return;
        throw new AppError(403, 'insufficient_scope');
    }
}
export function tokenAllowsFarrierGet(caller, path) {
    if (!caller || caller.type !== 'token')
        return true;
    if (path.startsWith('/api/tokens') || path.startsWith('/api/audit') || path.startsWith('/api/jobs'))
        return false;
    if (path.includes('/events'))
        return false;
    if (caller.scope === 'read_only' && (path.startsWith('/api/invoices') || path.startsWith('/api/payments')))
        return false;
    return true;
}
export function requireSession(caller) {
    if (!caller)
        throw new AppError(401, 'unauthenticated');
    if (caller.type === 'token')
        throw new AppError(403, 'forbidden');
    return caller;
}
export function isFarrierRole(caller) {
    if (!caller)
        return false;
    if (caller.type === 'token')
        return true;
    return caller.role === 'farrier';
}
export function isStaffRole(caller) {
    if (!caller)
        return false;
    if (caller.type === 'token')
        return true;
    return caller.role === 'farrier' || caller.role === 'apprentice';
}
