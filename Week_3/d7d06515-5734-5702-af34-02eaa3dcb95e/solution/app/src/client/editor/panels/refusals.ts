// The one mapping from API error codes to published copy for the panels and dialogs (brief: Feedback states).
import { COPY, copy } from '../../../shared/copy.ts';
import { ApiError } from '../../api.ts';
import { GENERIC_ERROR, fieldMessages } from '../../pages/errors.ts';

export type LayerOp = 'new' | 'set' | 'rename' | 'current' | 'delete';

/** Access refusals every write can meet; `forbidden` has no published copy of its own. */
export function accessRefusal(code: string | undefined): string | null {
  if (code === 'view_only') return COPY.viewOnly;
  if (code === 'markup_only') return COPY.markupOnly;
  if (code === 'trial_ended') return COPY.trialEnded;
  return null;
}

/** First message of a 422, or null when the answer carried none. */
export function firstFieldMessage(error: unknown): string | null {
  return Object.values(fieldMessages(error))[0] ?? null;
}

/** Why a LAYER command was refused, for the alert inside the Layers panel. */
export function layerRefusal(error: unknown, op: LayerOp, name: string): string {
  if (!(error instanceof ApiError)) throw error;
  switch (error.code) {
    case 'layer_zero': return op === 'rename' ? COPY.layerZeroRename : COPY.layerZeroDelete;
    case 'layer_current': return op === 'delete' ? copy.layerCurrentDelete(name) : copy.layerCurrentFreeze(name);
    case 'layer_locked': return copy.layerLockedDelete(name);
    case 'layer_in_use': return copy.layerInUse(name, Number(error.body.objects ?? 0));
    default: return accessRefusal(error.code) ?? firstFieldMessage(error) ?? GENERIC_ERROR;
  }
}

/** Why an invite or a share link was refused. */
export function inviteRefusal(error: unknown, email: string): string {
  if (!(error instanceof ApiError)) throw error;
  if (error.code === 'invite_cooldown') return copy.inviteCooldown(email, Number(error.body.retry_after_seconds ?? 0));
  if (error.code === 'mail_unavailable') return COPY.mailUnavailableInvite;
  return accessRefusal(error.code) ?? firstFieldMessage(error) ?? GENERIC_ERROR;
}

/** Why an export, a title-block revision or a trace action was refused. */
export function writeRefusal(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  if (error.code === 'storage_unavailable') return COPY.storageUnavailableExport;
  return accessRefusal(error.code) ?? GENERIC_ERROR;
}
