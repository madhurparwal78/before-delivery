import type { FieldEnv } from './field.ts';

interface TypedBox { commit(): void }

/**
 * A short text, number or date box commits when it loses focus and when Enter is pressed (then Next or Submit is pressed).
 * A long text box commits on blur only: its Enter is a new line.
 */
export function wireTypedBox(control: HTMLInputElement | HTMLTextAreaElement, key: string, env: FieldEnv): TypedBox {
  let sent = control.value;
  const commit = (): void => {
    if (control.value === sent) return;
    sent = control.value;
    env.commit(key, sent === '' ? null : sent);
  };
  control.addEventListener('blur', commit);
  if (control instanceof HTMLInputElement) {
    control.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      commit();
      env.advance();
    });
  }
  return { commit };
}
