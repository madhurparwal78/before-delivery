import { config, names } from '../config.js';
import { query } from '../db.js';

export class AlertsUnreachable extends Error {}

async function push(title: string, body: string): Promise<void> {
  const headers: Record<string, string> = { Title: title, 'Content-Type': 'text/plain' };
  if (config.ntfy.username !== undefined && config.ntfy.password !== undefined) {
    headers.Authorization = `Basic ${Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString('base64')}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${config.ntfy.url}/${names.makerTopic}`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new AlertsUnreachable(`ntfy ${response.status}`);
  } catch (error) {
    if (error instanceof AlertsUnreachable) throw error;
    throw new AlertsUnreachable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

/** Alerts are kept in Postgres and sent on the next sweep if ntfy is down. */
export async function alertMaker(title: string, body: string): Promise<void> {
  const rows = await query<{ id: string }>(
    'INSERT INTO pending_alerts (title, body) VALUES ($1, $2) RETURNING id',
    [title, body],
  );
  const id = rows[0]?.id;
  try {
    await push(title, body);
    await query('UPDATE pending_alerts SET sent_at = now() WHERE id = $1', [id]);
  } catch {
    /* kept for the sweep */
  }
}

export async function alertsWaiting(): Promise<boolean> {
  const rows = await query<{ count: string }>(
    'SELECT count(*)::text AS count FROM pending_alerts WHERE sent_at IS NULL',
  );
  return Number(rows[0]?.count ?? '0') > 0;
}

export async function flushAlerts(): Promise<void> {
  const rows = await query<{ id: string; title: string; body: string }>(
    'SELECT id, title, body FROM pending_alerts WHERE sent_at IS NULL ORDER BY id LIMIT 50',
  );
  for (const row of rows) {
    try {
      await push(row.title, row.body);
      await query('UPDATE pending_alerts SET sent_at = now() WHERE id = $1', [row.id]);
    } catch {
      return;
    }
  }
}
