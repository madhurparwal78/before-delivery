import type { Response } from 'express';
import type { Json } from '../types.js';
import { httpDate } from '../clock.js';

/**
 * The single JSON writer: appends the server clock in the Date header, as it does for every response.
 */
export function sendJson(res: Response, status: number, body: Json): void {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Date', httpDate());
  res.json(body);
}
