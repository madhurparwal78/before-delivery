import { now } from '../clock.js';
import { transaction } from '../db.js';
import { ApiError } from '../errors.js';
import { json, type Reply, type RequestContext } from '../http.js';
import { createDraft } from '../domain/hours.js';
import { claimKey, forgetKey, rememberResponse } from '../domain/idempotency.js';
import { issueLink } from '../domain/links.js';
import { confirmationLetter } from '../domain/mail.js';
import { deliverNow, enqueue } from '../domain/outbox.js';
import { readPlanInput } from '../domain/planRules.js';
import { countRequest } from '../domain/rateLimit.js';

const KEY_PATTERN = /^[\x20-\x7e]{8,64}$/;

export async function savePlan(ctx: RequestContext): Promise<Reply> {
  const at = await now();
  const key = ctx.header('idempotency-key');
  if (!key || !KEY_PATTERN.test(key)) throw new ApiError('idempotency_key_required');
  const body = ctx.body ?? {};

  const claim = await claimKey(key, body, at);
  if (!claim.owned) return json(claim.status, claim.body);

  try {
    const values = readPlanInput('create', body);
    await countRequest('plan', values.email!, at);

    const letterId = await transaction(async (client) => {
      const draft = await createDraft(
        client,
        {
          email: values.email!,
          bedtime: values.bedtime!,
          timeZone: values.timeZone!,
          rituals: values.rituals!,
          note: values.note!,
        },
        at,
      );
      const token = await issueLink(client, { email: draft.email, kind: 'confirm', draftId: draft.id }, at);
      return enqueue(
        client,
        confirmationLetter({
          email: draft.email,
          bedtime: draft.bedtime,
          timeZone: draft.time_zone,
          rituals: draft.rituals,
          token,
        }),
        at,
      );
    });

    const delivered = await deliverNow(letterId);
    const answer = { status: delivered ? 'confirmation_sent' : 'confirmation_queued' };
    await rememberResponse(key, 202, answer);
    return json(202, answer);
  } catch (error) {
    await forgetKey(key).catch(() => undefined);
    throw error;
  }
}
