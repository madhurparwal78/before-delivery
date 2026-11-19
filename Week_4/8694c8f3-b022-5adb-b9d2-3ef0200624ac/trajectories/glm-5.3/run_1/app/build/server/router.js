import { ApiError, errors } from './errors.js';
const JSON_LIMIT = 1_000_000;
export class Router {
    routes = [];
    add(method, path, handler) {
        const paramNames = [];
        const source = path.split('/').map((segment) => {
            if (segment.startsWith(':')) {
                paramNames.push(segment.slice(1));
                return '([^/]+)';
            }
            return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('/');
        this.routes.push({ method, pattern: new RegExp(`^${source}$`), paramNames, handler });
        return this;
    }
    async dispatch(req, res) {
        const url = new URL(req.url ?? '/', 'http://local');
        for (const route of this.routes) {
            if (route.method !== req.method)
                continue;
            const match = route.pattern.exec(url.pathname);
            if (match === null)
                continue;
            const params = {};
            route.paramNames.forEach((name, index) => { params[name] = decodeURIComponent(match[index + 1]); });
            try {
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    checkSameOrigin(req);
                    checkContentType(req);
                }
                await route.handler({ req, res, url, params, user: null, setId: () => { } });
                return;
            }
            catch (error) {
                if (error instanceof ApiError) {
                    sendJsonError(res, error);
                    return;
                }
                console.error('Unhandled error', error);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                }
                res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong' } }));
                return;
            }
        }
        sendJsonError(res, errors.notFound());
    }
}
function checkSameOrigin(req) {
    const origin = req.headers.origin;
    if (origin === undefined)
        return;
    const host = req.headers.host ?? '';
    try {
        if (new URL(origin).host !== host) {
            throw errors.forbiddenOrigin();
        }
    }
    catch (error) {
        if (error instanceof ApiError)
            throw error;
        throw errors.forbiddenOrigin();
    }
}
function checkContentType(req) {
    const contentType = req.headers['content-type'] ?? '';
    const base = contentType.split(';')[0].trim().toLowerCase();
    if (base === '' || base === 'application/json')
        return;
    // Multipart endpoints check their own content type before parsing.
    if (base === 'multipart/form-data')
        return;
    throw errors.unsupportedMediaType(contentType);
}
export function sendJsonError(res, error) {
    if (res.headersSent) {
        res.end();
        return;
    }
    res.writeHead(error.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: error.code, message: error.message, ...(error.fields !== undefined ? { fields: error.fields } : {}), ...(error.extra ?? {}) } }));
}
export { JSON_LIMIT };
