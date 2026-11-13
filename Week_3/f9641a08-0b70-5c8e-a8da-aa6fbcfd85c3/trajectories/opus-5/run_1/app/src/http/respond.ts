import { Ctx } from './context';

function headers(ctx: Ctx, extra: Record<string, string>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...extra
  };
  if (ctx.setCookies.length > 0) out['Set-Cookie'] = ctx.setCookies;
  return out;
}

export function sendJson(ctx: Ctx, status: number, payload: unknown, extra: Record<string, string> = {}): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  ctx.response.writeHead(
    status,
    headers(ctx, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(body.length), 'Cache-Control': 'no-store', ...extra })
  );
  ctx.response.end(ctx.method === 'HEAD' ? undefined : body);
}

export function sendHtml(ctx: Ctx, status: number, html: string): void {
  const body = Buffer.from(html, 'utf8');
  ctx.response.writeHead(
    status,
    headers(ctx, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store'
    })
  );
  ctx.response.end(ctx.method === 'HEAD' ? undefined : body);
}

export function sendText(ctx: Ctx, status: number, text: string, contentType: string, extra: Record<string, string> = {}): void {
  const body = Buffer.from(text, 'utf8');
  ctx.response.writeHead(
    status,
    headers(ctx, { 'Content-Type': contentType, 'Content-Length': String(body.length), 'Cache-Control': 'no-store', ...extra })
  );
  ctx.response.end(ctx.method === 'HEAD' ? undefined : body);
}

export function sendBytes(
  ctx: Ctx,
  status: number,
  data: Buffer,
  contentType: string,
  extra: Record<string, string> = {}
): void {
  ctx.response.writeHead(
    status,
    headers(ctx, { 'Content-Type': contentType, 'Content-Length': String(data.length), ...extra })
  );
  ctx.response.end(ctx.method === 'HEAD' ? undefined : data);
}

export function redirect(ctx: Ctx, location: string): void {
  ctx.response.writeHead(302, headers(ctx, { Location: location }));
  ctx.response.end();
}
