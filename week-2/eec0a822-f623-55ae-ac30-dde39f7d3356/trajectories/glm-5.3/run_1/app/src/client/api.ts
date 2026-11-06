export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: any,
  ) {
    super(JSON.stringify(body));
  }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    credentials: 'same-origin',
  });
  if (res.status === 204) return null as T;
  let body: any = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}

export interface FieldErrors {
  [field: string]: string;
}

/** Human copy for error codes, matching the published feedback states. */
export function errorCopy(err: ApiError, ctx: Record<string, string | undefined> = {}): { message: string; fields?: FieldErrors; focusField?: string } {
  const body = err.body ?? {};
  if (err.status === 401 && body.error === 'invalid_credentials') return { message: 'The email or password isn\'t right.' };
  if (err.status === 401 && body.error === 'session_ended') return { message: 'Your session has ended. Sign in again — what you typed is kept.' };
  if (err.status === 401 && body.error === 'access_removed') return { message: 'Your access to this workspace was removed. Ask your fleet director if this is a mistake.' };
  if (err.status === 401) return { message: 'Your session has ended. Sign in again — what you typed is kept.' };
  if (err.status === 422 && body.errors) return { message: '', fields: body.errors as FieldErrors };
  if (err.status === 422 && body.error === 'rest_rule') {
    return { message: `${ctx.crewName ?? body.crewName} breaks the rest rules: ${ctx.ruleText ?? body.rule}, from ${ctx.windowStart ?? body.windowStart} to ${ctx.windowEnd ?? body.windowEnd}.` };
  }
  if (err.status === 412 && body.error === 'stale_rota') {
    return { message: `${body.savedBy} saved this rota at ${ctx.savedAt ?? body.savedAt}. Your changes are still here — check them and save again.` };
  }
  if (err.status === 409) {
    switch (body.error) {
      case 'week_taken': return { message: `Too late — ${body.takenBy} took this week at ${ctx.takenAt ?? body.takenAt}.` };
      case 'week_booked': return { message: 'This week is already booked.' };
      case 'hold_lapsed': return { message: `Too late — this hold lapsed at ${ctx.lapsedAt ?? body.lapsedAt}.` };
      case 'hold_not_live': return { message: 'This hold is no longer live.' };
      case 'charter_closed': return { message: 'This charter is already closed.' };
      case 'does_not_fit': return { message: `${ctx.yachtName} doesn't fit berth ${ctx.berthCode}.` };
      case 'berth_taken': return { message: `Berth ${ctx.berthCode} is already booked for one of those nights.` };
      case 'slot_taken': return { message: `Too late — ${body.takenBy} took this slot at ${ctx.takenAt ?? body.takenAt}.` };
      case 'slot_past': return { message: 'That slot has already started.' };
      case 'already_booked': return { message: 'This yacht already has that slot.' };
      case 'insufficient_stock': return { message: `Only ${body.onHandQty} ${ctx.unit ?? ''} on hand — you can't log more than that.` };
      case 'item_exists': return { message: `There's already an item called ${ctx.name}.` };
      case 'manifest_full': return { message: `This yacht takes at most ${body.maxGuests} guests.` };
      case 'already_withdrawn': return { message: 'This yacht is already withdrawn.' };
      case 'already_on_sale': return { message: 'This yacht is already on sale.' };
      case 'page_not_live': return { message: 'That page is not live.' };
      case 'date_exists': return { message: 'There is already one from that date.' };
    }
  }
  if (err.status === 410 && body.error === 'yacht_withdrawn') return { message: 'This yacht has been withdrawn from charter.' };
  if (err.status === 429) return { message: `Too many hold requests — try again in ${body.retryAfterSeconds} seconds.` };
  if (err.status === 503) {
    if (body.error === 'billing_unavailable') return { message: 'Invoicing is unavailable right now — no charter was recorded and no mail was sent. Try again in a few minutes.' };
    if (body.error === 'mail_unavailable') return { message: 'Mail is unavailable right now — no charter was recorded. Try again in a few minutes.' };
    if (body.error === 'storage_unavailable') return { message: 'Uploads are unavailable right now — nothing was saved. Try again in a few minutes.' };
  }
  return { message: 'Something went wrong — nothing was changed. Try again.' };
}
