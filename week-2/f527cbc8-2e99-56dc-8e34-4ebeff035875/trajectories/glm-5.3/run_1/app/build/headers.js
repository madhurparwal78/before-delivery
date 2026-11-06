export function stdHeaders() {
    return {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store'
    };
}
export const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
export const MIME = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.ttf': 'font/ttf',
    '.html': 'text/html; charset=utf-8'
};
export function peerAddress(req) {
    return req.socket.remoteAddress ?? '?';
}
