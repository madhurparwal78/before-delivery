import { ApiError } from './errors.js';
export class Router {
    #routes = [];
    add(method, path, handler, opts = {}) {
        const paramNames = [];
        const source = path
            .split('/')
            .map(seg => {
            if (seg.startsWith(':')) {
                paramNames.push(seg.slice(1));
                return '([^/]+)';
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
            .join('/');
        this.#routes.push({
            method,
            pattern: new RegExp(`^${source}$`),
            paramNames,
            handler,
            needsMember: opts.member ?? true,
            json: opts.json ?? true,
        });
    }
    match(method, path) {
        for (const route of this.#routes) {
            if (route.method !== method)
                continue;
            const m = route.pattern.exec(path);
            if (!m)
                continue;
            const params = {};
            route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
            return { route, params };
        }
        return null;
    }
}
export function sendJson(res, status, payload, headers = {}) {
    const text = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(Buffer.byteLength(text)),
        'Cache-Control': 'no-store',
        ...headers,
    });
    res.end(text);
}
export function sendError(res, e) {
    if (e instanceof ApiError) {
        sendJson(res, e.status, e.body(), e.headers ?? {});
        return;
    }
    console.error('internal error', e);
    sendJson(res, 500, { error: 'internal', message: 'Something went wrong.' });
}
export function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0)
            continue;
        out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return out;
}
