/** Dialogs: one focus trap, one Escape rule, one step-up protocol. */

import { announce, el, focusables, takeFocus } from './dom.js';
import { post } from './api.js';

const host = () => document.getElementById('dialogs');
export const openDialogs = new Set();

export function openDialog({ label, build, opener, fallback, onClose }) {
  const scrim = el('div', { class: 'scrim' });
  const root = el('div', {
    class: 'dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': label,
  });
  const handle = {
    root,
    label,
    opener,
    close(silent) {
      if (!openDialogs.has(handle)) return;
      openDialogs.delete(handle);
      root.remove();
      scrim.remove();
      if (!silent) {
        const back =
          opener && document.body.contains(opener) ? opener : fallback && fallback();
        takeFocus(back);
      }
      if (onClose) onClose(silent);
    },
  };
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(root);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  build(root, handle);
  host().append(scrim, root);
  openDialogs.add(handle);
  return handle;
}

export function closeAllDialogs() {
  for (const handle of Array.from(openDialogs)) {
    handle.close(true);
  }
}

export function dialogHoldsTypedText() {
  for (const handle of openDialogs) {
    if (handle.unsavedWork && handle.unsavedWork()) return true;
  }
  return false;
}

const STEP_UP_WRONG = 'Password or code is not right.';
const STEP_UP_LOCKED = 'Too many attempts. Try again later.';

/**
 * Opens the step-up dialog and runs the action with a fresh proof.
 * Resolves with the action's reply, or null when the dialog was cancelled.
 */
export function stepUp({ needsReason, opener, run, fallback }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const status = el('p', {
      role: 'status',
      'aria-label': 'Step-up status',
      'aria-live': 'polite',
    });
    const reasonError = el('p', { class: 'field-error', hidden: true });
    const reasonInput = el('textarea', {
      id: 'step-up-reason',
      rows: 3,
      'aria-label': 'Reason',
      'aria-describedby': '',
    });
    const passwordInput = el('input', { type: 'password', id: 'step-up-password' });
    const codeInput = el('input', { type: 'text', id: 'step-up-code' });
    const handle = openDialog({
      label: 'Step-up',
      opener,
      fallback,
      onClose: () => finish(null),
      build: (root) => {
        if (needsReason) {
          const label = el('label', { for: 'step-up-reason', text: 'Reason' });
          root.append(label, reasonInput, reasonError);
        }
        root.append(
          el('label', { for: 'step-up-password', text: 'Password' }),
          passwordInput,
          el('label', { for: 'step-up-code', text: 'Authenticator code' }),
          codeInput,
          el('div', { class: 'row' }, [confirmButton(), cancelButton()]),
          status
        );
      },
    });
    handle.unsavedWork = () => needsReason && reasonInput.value.trim() !== '';
    handle.reasonValue = () => reasonInput.value;
    handle.resetSecrets = () => {
      passwordInput.value = '';
      codeInput.value = '';
      passwordInput.focus();
    };

    function confirmButton() {
      return el('button', {
        type: 'button',
        text: 'Confirm',
        on: { click: confirm },
      });
    }

    function cancelButton() {
      return el('button', {
        type: 'button',
        text: 'Cancel',
        on: {
          click: () => {
            handle.close();
          },
        },
      });
    }

    for (const input of [reasonInput, passwordInput, codeInput]) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && input !== reasonInput) {
          event.preventDefault();
          confirm();
        }
      });
    }

    async function confirm() {
      announce(status, '');
      reasonError.hidden = true;
      const proofReply = await post('/api/step-up', {
        password: passwordInput.value,
        code: codeInput.value,
      });
      if (proofReply.status === 429) {
        announce(status, STEP_UP_LOCKED);
        handle.resetSecrets();
        return;
      }
      if (proofReply.status !== 201) {
        announce(status, STEP_UP_WRONG);
        handle.resetSecrets();
        return;
      }
      const reply = await run(proofReply.body.proof, reasonInput.value);
      if (
        reply &&
        reply.status === 422 &&
        reply.body &&
        reply.body.errors &&
        reply.body.errors.reason
      ) {
        reasonError.textContent = reply.body.errors.reason;
        reasonError.hidden = false;
        reasonInput.setAttribute('aria-invalid', 'true');
        announce(status, reply.body.errors.reason);
        passwordInput.value = '';
        codeInput.value = '';
        reasonInput.focus();
        return;
      }
      settled = true;
      handle.close(true);
      resolve(reply);
    }

    const first = needsReason ? reasonInput : passwordInput;
    setTimeout(() => first.focus(), 0);
  });
}

