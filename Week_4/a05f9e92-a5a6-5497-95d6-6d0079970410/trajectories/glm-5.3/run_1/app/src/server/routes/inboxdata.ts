// Shared inbox helpers for route modules.

import { Db } from '../db.js';
import { deliver as deliverItem } from '../inbox.js';

export async function loadRules(db: Db): Promise<Array<{ event: string; roles: string[]; enabled: boolean }>> {
  const res = await db.query(`SELECT event, roles, enabled FROM inbox_rules`);
  return res.rows.map((r: Record<string, unknown>) => ({
    event: String(r.event),
    roles: r.roles as string[],
    enabled: Boolean(r.enabled),
  }));
}

export async function deliver(db: Db, rules: Array<{ event: string; roles: string[]; enabled: boolean }>, event: string, username: string, text: string, record: string | null): Promise<void> {
  await deliverItem(db, rules, event, username, text, record);
}
