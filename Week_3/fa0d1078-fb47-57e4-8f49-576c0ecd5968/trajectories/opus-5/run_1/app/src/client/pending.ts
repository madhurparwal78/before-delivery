import { announce } from './announcer';

/** While a request is in flight its button is disabled and a second press sends nothing. */
export async function pending<T>(
  control: HTMLElement,
  sentence: string | null,
  work: () => Promise<T>,
): Promise<T | undefined> {
  if (control.getAttribute('aria-disabled') === 'true') return undefined;
  control.setAttribute('aria-disabled', 'true');
  if (sentence) announce(sentence);
  try {
    return await work();
  } finally {
    control.setAttribute('aria-disabled', 'false');
  }
}
