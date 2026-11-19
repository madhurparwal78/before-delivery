import { readJson } from '../errors.js';
export function jsonOk(ctx, status, body) {
    ctx.res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    ctx.res.end(JSON.stringify(body));
}
export function noContent(ctx) {
    ctx.res.writeHead(204);
    ctx.res.end();
}
export async function readBody(ctx, limit) {
    return await readJson(ctx.req, limit);
}
