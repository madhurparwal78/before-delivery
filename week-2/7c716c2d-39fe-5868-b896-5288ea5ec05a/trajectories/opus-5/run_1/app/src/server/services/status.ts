import { nowDate } from '../clock.js';
import { db, databaseReachable, tx, type Queryable } from '../db.js';
import { appendEvent } from '../events.js';
import type { ServiceStatus } from '../../shared/types.js';
import { killbillReachable } from './killbill.js';
import { heldMailCount, mailDeliveryFailing } from './mail.js';
import { storageReachable } from './storage.js';

type Probe = {
  database: 'ok' | 'unavailable';
  storage: 'ok' | 'unavailable';
  billing: 'ok' | 'unavailable';
  mailFailing: boolean;
  checkedAt: number;
};

let probe: Probe = {
  database: 'unavailable',
  storage: 'unavailable',
  billing: 'unavailable',
  mailFailing: false,
  checkedAt: 0,
};

export function probedStatus(): Probe {
  return probe;
}

export async function refreshServiceStatus(): Promise<void> {
  const [database, storage, billing] = await Promise.all([
    databaseReachable(),
    storageReachable(),
    killbillReachable(),
  ]);
  const next: Probe = {
    database: database ? 'ok' : 'unavailable',
    storage: storage ? 'ok' : 'unavailable',
    billing: billing ? 'ok' : 'unavailable',
    mailFailing: mailDeliveryFailing(),
    checkedAt: Date.now(),
  };
  const changed =
    next.database !== probe.database ||
    next.storage !== probe.storage ||
    next.billing !== probe.billing ||
    next.mailFailing !== probe.mailFailing;
  probe = next;
  if (changed && next.database === 'ok') await announceNotice();
}

async function announceNotice(): Promise<void> {
  try {
    const workspaces = await db.query<{ id: string }>('select id from workspaces');
    const createdAt = nowDate().toISOString();
    for (const workspace of workspaces) {
      await tx(async (client) => {
        await appendEvent(client, workspace.id, 'notice', {}, { type: 'workspace' }, createdAt);
      });
    }
  } catch {
    // Without the database there is nothing to announce through.
  }
}

/** One notice event for the owner, whose held-mail count has changed. */
export async function noticeOwner(client: Queryable, workspaceId: string, createdAt: string): Promise<void> {
  const owners = await client.query<{ id: string }>(
    "select id from people where workspace_id = $1 and role = 'owner' and removed = false",
    [workspaceId],
  );
  for (const owner of owners) {
    await appendEvent(client, workspaceId, 'notice', {}, { type: 'person', id: owner.id }, createdAt);
  }
}

export async function serviceStatusFor(workspaceId: string | null, isOwner: boolean): Promise<ServiceStatus> {
  if (Date.now() - probe.checkedAt > 3000) await refreshServiceStatus();
  const state = probe;
  let held: number | null = null;
  let scopedHeld = 0;
  if (state.database === 'ok') {
    try {
      scopedHeld = await heldMailCount(workspaceId);
      if (isOwner) held = scopedHeld;
    } catch {
      held = null;
    }
  }
  return {
    database: state.database,
    mail: state.database === 'ok' && (scopedHeld > 0 || state.mailFailing) ? 'delayed' : 'ok',
    storage: state.storage,
    billing: state.billing,
    held_mail: state.database === 'ok' ? held : null,
  };
}

export function startStatusProbe(): void {
  void refreshServiceStatus();
  setInterval(() => {
    void refreshServiceStatus();
  }, 3000).unref();
}
