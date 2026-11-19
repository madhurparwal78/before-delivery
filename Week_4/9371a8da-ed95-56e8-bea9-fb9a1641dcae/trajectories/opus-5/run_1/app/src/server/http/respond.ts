import { ServerResponse } from 'node:http';
import { ApiError } from './errors.js';

export function securityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', payload.length);
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(payload);
}

export function sendEmpty(
  response: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
): void {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end();
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  bytes: Buffer,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', bytes.length);
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(bytes);
}

export function sendError(response: ServerResponse, error: ApiError): void {
  sendJson(response, error.httpStatus, error.body(), error.headers);
}
