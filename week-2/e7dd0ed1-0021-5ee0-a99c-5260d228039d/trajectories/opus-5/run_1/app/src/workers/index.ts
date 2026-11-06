import { query } from '../db';
import { config } from '../config';
import { deleteBytes } from '../services/storage';
import { flushMailOutbox } from '../services/mail';
import { runLifecycleSweep } from '../domain/lifecycle';
import { checkThresholds } from '../domain/alerts';
import { replicationTick } from './replication';
import { webhookTick } from './webhooks';
import { billingTick } from './billing';

function loop(name: string, intervalMs: number, tick: () => Promise<void>): void {
  const run = async (): Promise<void> => {
    try {
      await tick();
    } catch (error) {
      process.stderr.write(`${name} worker: ${(error as Error).message}\n`);
    } finally {
      setTimeout(run, intervalMs).unref();
    }
  };
  setTimeout(run, intervalMs).unref();
}

async function byteRemovalTick(): Promise<void> {
  const pending = await query<{ id: string; storage_key: string }>(
    'select id, storage_key from pending_byte_removals order by id limit 20',
  );
  for (const removal of pending) {
    await deleteBytes(removal.storage_key);
    await query('delete from pending_byte_removals where id = $1', [removal.id]);
  }
}

async function thresholdTick(): Promise<void> {
  const workspaces = await query<{ slug: string }>('select slug from workspaces order by slug');
  for (const workspace of workspaces) await checkThresholds(workspace.slug);
}

export function startWorkers(): void {
  loop('replication', 250, replicationTick);
  loop('webhooks', 400, webhookTick);
  loop('mail', 3000, flushMailOutbox);
  loop('byte-removal', 1000, byteRemovalTick);
  loop('thresholds', 5000, thresholdTick);
  loop('lifecycle', Math.max(1, config.timing.lifecycleSweep) * 1000, async () => {
    await runLifecycleSweep();
  });
  loop('billing', Math.max(1, config.timing.billingSync) * 1000, billingTick);
}
