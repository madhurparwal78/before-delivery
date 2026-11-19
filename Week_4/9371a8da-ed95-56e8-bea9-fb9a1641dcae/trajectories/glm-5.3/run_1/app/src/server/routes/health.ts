import type { Express } from 'express';

export function registerHealth(app: Express): void {
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
}
