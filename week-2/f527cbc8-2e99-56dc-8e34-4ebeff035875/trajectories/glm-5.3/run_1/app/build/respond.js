import { AppError } from './errors.js';
export function send(res, requestId, status, body, extraHeaders = {}) {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Request-Id': requestId,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        ...extraHeaders
    };
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
}
export function send204(res, requestId) {
    res.writeHead(204, { 'X-Request-Id': requestId, 'Content-Length': '0' });
    res.end();
}
export function sendHtml(res, requestId, html, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Request-Id': requestId,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store'
    });
    res.end(html);
}
export function requireJson(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new AppError(400, 'bad_request');
    }
    return body;
}
export function str(v) {
    return typeof v === 'string' ? v : null;
}
export function numField(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
