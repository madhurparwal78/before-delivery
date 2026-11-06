import type { AppCtx, ServiceStatus } from '../context.ts';

/**
 * Service status probing with a 5-second cache. A background loop keeps
 * ctx.status fresh so staff screens learn of an outage within seconds.
 */
export async function probeServices(ctx: AppCtx): Promise<ServiceStatus> {
  const [storage, billing, mail] = await Promise.all([
    ctx.storage.health(),
    ctx.killbill.health(),
    ctx.mail.health(),
  ]);
  return {
    storage: storage ? 'up' : 'down',
    billing: billing ? 'up' : 'down',
    mail: mail ? 'up' : 'down',
    checkedAt: Date.now(),
  };
}

export async function refreshStatus(ctx: AppCtx): Promise<ServiceStatus> {
  const status = await probeServices(ctx);
  ctx.status.storage = status.storage;
  ctx.status.billing = status.billing;
  ctx.status.mail = status.mail;
  ctx.status.checkedAt = status.checkedAt;
  return status;
}

export function startStatusLoop(ctx: AppCtx): void {
  const timer = setInterval(async () => {
    try {
      await refreshStatus(ctx);
    } catch {
      // probes report down on their own
    }
  }, 5_000);
  timer.unref();
}

export async function isStorageDown(ctx: AppCtx): Promise<boolean> {
  return ctx.status.storage === 'down';
}

export async function isBillingDown(ctx: AppCtx): Promise<boolean> {
  return ctx.status.billing === 'down';
}

export async function isMailDown(ctx: AppCtx): Promise<boolean> {
  return ctx.status.mail === 'down';
}
