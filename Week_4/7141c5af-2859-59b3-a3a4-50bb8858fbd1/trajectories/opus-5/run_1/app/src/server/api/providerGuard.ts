/**
 * A 429 from a provider, with its Retry-After, means no call to that provider
 * before the instant it named. Both providers share this one gate.
 */
import { BUSINESS_ZONE, localMinuteCeil } from '../domain/time.ts';
import { fail } from '../http/errors.ts';
import type { Ctx } from '../http/context.ts';
import type { Row } from '../present.ts';
import { ProviderBusy, ProviderUnavailable } from '../services/providers.ts';

export type ProviderName = 'supplier' | 'courier';

async function noteBusy(ctx: Ctx, provider: ProviderName, retryAt: number): Promise<void> {
  await ctx.app.db.query(
    `INSERT INTO provider_backoff (provider, retry_at) VALUES ($1,$2)
     ON CONFLICT (provider) DO UPDATE SET retry_at = $2`,
    [provider, new Date(retryAt)],
  );
}

function busyRefusal(ctx: Ctx, retryAt: number, busy: (minute: string) => string): never {
  throw fail.rateLimited(
    busy(localMinuteCeil(BUSINESS_ZONE, retryAt)),
    (retryAt - ctx.app.now()) / 1000,
  );
}

/** Refuses before any call when the provider is still in its back-off. */
export async function guardProvider(
  ctx: Ctx,
  provider: ProviderName,
  busy: (minute: string) => string,
): Promise<void> {
  const row = await ctx.app.db.one<Row>(
    `SELECT retry_at FROM provider_backoff WHERE provider = $1`,
    [provider],
  );
  if (!row) return;
  const retryAt = new Date(row.retry_at as string).getTime();
  if (retryAt > ctx.app.now()) busyRefusal(ctx, retryAt, busy);
}

/** Turns a provider failure into its published refusal. */
export async function providerFailure(
  ctx: Ctx,
  provider: ProviderName,
  error: unknown,
  copy: { busy: (minute: string) => string; down: string },
): Promise<never> {
  if (error instanceof ProviderBusy) {
    await noteBusy(ctx, provider, error.retryAt);
    busyRefusal(ctx, error.retryAt, copy.busy);
  }
  if (error instanceof ProviderUnavailable) throw fail.unavailable(copy.down);
  throw error;
}
