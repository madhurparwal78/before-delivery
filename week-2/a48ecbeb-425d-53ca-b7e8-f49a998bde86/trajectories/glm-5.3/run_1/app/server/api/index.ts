import './async-wrap.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { attachUser } from './session.js';
import { jsonBodyLimit, requireOrigin, refreshServiceStatus } from './middleware.js';
import { catalogRouter } from './catalog.js';
import { accountsRouter } from './accounts.js';
import { checkoutRouter } from './checkout.js';
import { subscriptionsRouter } from './subscriptions.js';
import { staffRouter } from './staff.js';
import { ownerRouter } from './owner.js';
import { liveHandler } from './live.js';

export const api = express.Router();
api.use(cookieParser());
api.use(requireOrigin);
api.use(jsonBodyLimit);
api.use(attachUser);

api.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

api.get('/live', liveHandler as unknown as (req: Request, res: Response) => void);

api.use(catalogRouter);
api.use(accountsRouter);
api.use(checkoutRouter);
api.use(subscriptionsRouter);
api.use(staffRouter);
api.use(ownerRouter);

api.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found', message: "We couldn't find that page." });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
api.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const anyErr = err as { status?: number; code?: string; fields?: Record<string, string>; extras?: Record<string, unknown> };
  const status = anyErr.status ?? 500;
  const code = anyErr.code ?? 'internal_error';
  if (status >= 500) {
    console.error(`[api] ${req.method} ${req.path} failed:`, err.message);
  }
  const body: Record<string, unknown> = { error: code, message: err.message || 'Something went wrong.' };
  if (anyErr.fields) body.fields = anyErr.fields;
  if (anyErr.extras) for (const [k, v] of Object.entries(anyErr.extras)) body[k] = v;
  if (!res.headersSent) {
    res.status(status).json(body);
  } else {
    res.end();
  }
});

export { refreshServiceStatus };
