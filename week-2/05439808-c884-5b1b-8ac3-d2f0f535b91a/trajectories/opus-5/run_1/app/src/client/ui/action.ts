import { ApiRequestError } from '../api.js';
import { errorCopy, type ActionKey } from '../copy.js';
import type { FieldControl } from '../dom.js';
import { showFieldError } from '../dom.js';
import { alertNotice, notice } from '../regions.js';

export type RunOptions<T> = {
  action: ActionKey;
  pending: string;
  control?: HTMLButtonElement | null;
  fields?: Record<string, FieldControl>;
  work: () => Promise<T>;
  success?: (result: T) => string | null;
};

export async function run<T>(options: RunOptions<T>): Promise<T | null> {
  const { control, fields } = options;
  if (control?.dataset.busy === 'true') return null;
  if (control) {
    control.dataset.busy = 'true';
    control.setAttribute('aria-busy', 'true');
    control.disabled = true;
  }
  for (const field of Object.values(fields ?? {})) showFieldError(field, null);
  notice(options.pending);
  try {
    const result = await options.work();
    const message = options.success?.(result);
    if (message !== null && message !== undefined) notice(message);
    return result;
  } catch (error) {
    if (error instanceof ApiRequestError) {
      alertNotice(errorCopy(options.action, error.failure));
      const errors = error.failure.errors;
      if (errors) {
        for (const [name, message] of Object.entries(errors)) {
          const field = fields?.[name];
          if (field) showFieldError(field, message);
        }
      }
    } else {
      alertNotice(errorCopy(options.action, {
        code: 'internal',
        message: 'failed',
        errors: null,
        nextClaimAt: null,
        nextDonationAt: null,
        retryAfter: null,
        status: 500
      }));
    }
    return null;
  } finally {
    if (control) {
      control.dataset.busy = 'false';
      control.removeAttribute('aria-busy');
      control.disabled = false;
    }
  }
}
