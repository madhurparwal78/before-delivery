import { appNow, iso, parseIsoInstant } from '../clock.js';
import { resetToSeed, writeClockOffset } from '../db.js';
import { fail } from '../errors.js';
import type { Reply, RequestContext } from '../http.js';
import { deleteKey, scanPrefix } from '../ledger.js';
import { rebuildAllKeys } from '../domain/rebuild.js';
import { advanceInstants, settleDue } from '../domain/settle.js';
import { returnEndedHolds } from '../domain/locks.js';

function testSurfaceOn(): void {
  if (process.env.APP_TEST_CLOCK !== '1') fail('not_found');
}

export async function setClock(ctx: RequestContext): Promise<Reply> {
  testSurfaceOn();
  const body = ctx.body();
  const at = parseIsoInstant(body.at);
  if (!at) fail('invalid_body');
  const freeze = body.freeze === true;
  await writeClockOffset(at.getTime() - Date.now(), freeze ? at.getTime() : null);
  await settleDue();
  await returnEndedHolds().catch(() => undefined);
  await advanceInstants();
  return { status: 200, json: { now: iso(appNow()) } };
}

export async function resetAll(): Promise<Reply> {
  testSurfaceOn();
  await resetToSeed();
  try {
    for (const key of await scanPrefix()) await deleteKey(key);
    await rebuildAllKeys();
  } catch {
    /* the sweep rebuilds the keys once the ledger answers again */
  }
  return { status: 200, json: { now: iso(appNow()) } };
}
