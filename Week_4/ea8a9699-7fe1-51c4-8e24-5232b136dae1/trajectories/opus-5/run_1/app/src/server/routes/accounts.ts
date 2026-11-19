import { query } from '../db.js';
import type { Viewer } from '../auth.js';
import type { Account, AccountWorkspace } from '../../shared/types.js';

export async function accountView(viewer: Viewer): Promise<Account> {
  let workspaces: AccountWorkspace[] = [];
  if (viewer.role === 'ops_lead' && viewer.group_id !== null) {
    const rows = await query<{ slug: string; name: string; time_zone: string }>(
      'select slug, name, time_zone from workspaces where group_id = $1 order by sort_order',
      [viewer.group_id],
    );
    workspaces = rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      timeZone: row.time_zone,
      hasSeat: false,
    }));
  } else if (viewer.role === 'designer' && viewer.workspace_id !== null) {
    const rows = await query<{ slug: string; name: string; time_zone: string; has_seat: boolean }>(
      `select w.slug, w.name, w.time_zone,
              exists (select 1 from seats s where s.workspace_id = w.id and s.account_id = $2) as has_seat
         from workspaces w where w.id = $1`,
      [viewer.workspace_id, viewer.id],
    );
    workspaces = rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      timeZone: row.time_zone,
      hasSeat: row.has_seat,
    }));
  }
  return {
    id: viewer.id,
    email: viewer.email,
    displayName: viewer.display_name,
    handle: viewer.handle,
    role: viewer.role,
    workspaces,
  };
}
