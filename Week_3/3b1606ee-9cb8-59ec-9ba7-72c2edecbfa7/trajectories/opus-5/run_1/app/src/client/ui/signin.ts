import { copy } from '../copy.js';
import { createIdentity, openKeyBackup } from '../crypto/identity.js';
import { recoveryMaterial } from '../crypto/recovery.js';
import { newProfileKey } from '../crypto/seal.js';
import { api, ApiFailure } from '../data/api.js';
import { saveIdentity } from '../data/keys.js';
import { state } from '../data/store.js';
import { attachSlip, button, el, field, sheet, withBusy } from './dom.js';
import { navigate } from './router.js';

export function signInScreen(onSignedIn: () => Promise<void>): HTMLElement {
  const { outer, inner } = sheet({ class: 'form-sheet' });
  const usernameInput = el('input', {
    attrs: { type: 'text', 'aria-label': 'Username', autocomplete: 'off', spellcheck: 'false' },
  });
  const codeInput = el('input', {
    attrs: { type: 'text', 'aria-label': 'Recovery code', autocomplete: 'off', spellcheck: 'false' },
  });
  const errors = el('div', { class: 'slip-holder' });
  const restore = button('Restore account', () => void run(), { class: 'ink-button' });

  async function run(): Promise<void> {
    await withBusy(restore, async () => {
      const username = usernameInput.value.trim().toLowerCase();
      const material = await recoveryMaterial(codeInput.value);
      const identity = await createIdentity(material.backupKey);
      try {
        const result = await api.recover({
          username,
          recovery_verifier: material.verifier,
          public_key: identity.publicKey,
          key_backup: identity.keyBackup,
        });
        const earlier = new Map<string, CryptoKey>();
        for (const backup of result.key_backups) {
          try {
            earlier.set(backup.key_id, await openKeyBackup(material.backupKey, backup));
          } catch {
            // A backup this recovery code cannot open belongs to another code.
          }
        }
        await saveIdentity(
          result.account.id,
          result.account.key_id,
          identity.privateKey,
          newProfileKey(),
          earlier,
        );
        state.me = result.account;
        state.signedOut = false;
        attachSlip(codeInput, errors, null);
        await onSignedIn();
        navigate('/letters');
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 429) {
          attachSlip(codeInput, errors, copy.restoreTooMany);
          return;
        }
        if (error instanceof ApiFailure && error.status === 401) {
          attachSlip(codeInput, errors, copy.restoreFailed);
          return;
        }
        attachSlip(codeInput, errors, copy.somethingWrong);
      }
    });
  }

  inner.append(
    el('div', { class: 'form-panel' }, [
      el('form', { class: 'step', on: { submit: (event) => {
        event.preventDefault();
        void run();
      } } }, [
        el('h1', { class: 'step-heading', text: 'Restore your account' }),
        field('Username', usernameInput),
        field('Recovery code', codeInput),
        errors,
        restore,
      ]),
    ]),
  );
  window.setTimeout(() => usernameInput.focus(), 0);
  return el('div', { class: 'form-screen' }, [outer]);
}
