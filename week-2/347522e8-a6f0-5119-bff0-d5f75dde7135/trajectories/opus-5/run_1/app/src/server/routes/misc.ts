/** The notification table the operator reads, and the health check. */

import { db } from '../db.js';
import { json, type Route } from '../http/router.js';

interface NotificationRow {
  id: string;
  kind: string;
  to_email: string;
  subject: string;
  status: 'queued' | 'sent';
  attempts: number;
  created_at: Date;
  sent_at: Date | null;
}

export const miscRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/notifications',
    auth: 'session',
    roles: ['operator'],
    async handle() {
      const rows = await db.query<NotificationRow>(
        `SELECT id, kind, to_email, subject, status, attempts, created_at, sent_at
           FROM notifications ORDER BY created_at DESC, id`,
      );
      return json(200, {
        notifications: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          to: row.to_email,
          subject: row.subject,
          status: row.status,
          attempts: row.attempts,
          created_at: row.created_at.toISOString(),
          sent_at: row.sent_at?.toISOString() ?? null,
        })),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/health',
    auth: 'none',
    async handle() {
      return json(200, { status: 'ok' });
    },
  },
];
