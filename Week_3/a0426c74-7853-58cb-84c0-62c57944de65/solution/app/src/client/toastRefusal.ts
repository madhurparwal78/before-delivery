import { onRefusal } from './api.ts';
import { pushToast } from './ui/index.ts';

/** Runs a request; a refusal shows as a toast with the server's sentences. */
export function toastRefusal(run: () => Promise<unknown>): Promise<void> {
  return onRefusal(run, (failure) => pushToast(failure.sentences.join(' ')));
}
