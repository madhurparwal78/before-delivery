// Dialogs: Tab wrap, Escape, focus return, the step-up flow and Sign in again.

import {
  api, ConnectionLost, field, h, icon, reducedMotion, registerUnsaved, session, setFieldError,
  clearFieldError, signedInAgain,
} from './core.js';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const stack = [];
let scrim = null;

function syncScrim() {
  if (stack.length && !scrim) {
    scrim = h('div', { class: 'dialog-scrim' });
    document.body.append(scrim);
  } else if (!stack.length && scrim) {
    scrim.remove();
    scrim = null;
  }
  if (scrim) scrim.style.zIndex = String(99 + stack.length * 2);
}

document.addEventListener('keydown', (event) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    top.onEscape();
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = [...top.element.querySelectorAll(FOCUSABLE)].filter((c) => c.offsetParent !== null || c === document.activeElement);
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  const inside = top.element.contains(document.activeElement);
  if (event.shiftKey && (document.activeElement === first || !inside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
    event.preventDefault();
    first.focus();
  }
});

// Opens a non-modal <dialog> so that status "Action status" behind it stays announced.
export function openDialog({ name, content, opener = null, fallback = null, onEscape = null, onClosed = null, wide = false }) {
  const element = h('dialog', { 'aria-label': name, class: `sheet-dialog ${wide ? 'wide' : ''}`.trim() }, h('h2', { class: 'dialog-title' }, name), content);
  const handle = {
    element,
    closed: false,
    onEscape: onEscape ?? (() => handle.close()),
    // Closes, returning focus to the opener or the published fallback.
    close({ returnFocus = true } = {}) {
      if (handle.closed) return;
      handle.closed = true;
      stack.splice(stack.indexOf(handle), 1);
      syncScrim();
      element.setAttribute('aria-hidden', 'true');
      element.inert = true;
      const finish = () => element.remove();
      if (reducedMotion.matches) finish();
      else {
        element.animate({ opacity: [1, 0] }, { duration: 250, easing: 'cubic-bezier(.16,1,.3,1)' }).finished.finally(finish);
        setTimeout(finish, 400);
      }
      if (returnFocus) {
        if (opener?.isConnected && !opener.disabled && opener.checkVisibility()) opener.focus();
        else fallback?.();
      }
      onClosed?.();
    },
  };
  stack.push(handle);
  syncScrim();
  document.body.append(element);
  element.style.zIndex = String(100 + stack.length * 2);
  element.show();
  if (!reducedMotion.matches) {
    element.animate({ opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0)'] }, { duration: 250, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  return handle;
}

export function closeAllDialogs() {
  for (const dialog of [...stack].reverse()) dialog.close({ returnFocus: false });
}

// Step-up. `run(proof, reason)` sends the action and returns its answer; `onAnswer(answer)` shows the outcome.
let activeStepUp = null;
registerUnsaved(() => Boolean(activeStepUp?.reasonBox?.value.trim()));

export function stepUp({ opener, fallback, needsReason = false, pending, run, onAnswer, onFailure }) {
  const reasonBox = needsReason ? h('textarea', { rows: 3 }) : null;
  const password = h('input', { type: 'password', autocomplete: 'current-password' });
  const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code' });
  const status = h('div', { role: 'status', 'aria-label': 'Step-up status', class: 'status-line' });
  const confirm = h('button', { type: 'submit', class: 'btn' }, 'Confirm');
  const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const form = h('form', { class: 'stack', novalidate: true },
    reasonBox ? field('Reason', reasonBox) : null,
    field('Password', password),
    field('Authenticator code', code),
    status,
    h('div', { class: 'button-row' }, confirm, cancel));

  const dialog = openDialog({ name: 'Step-up', content: form, opener, fallback });
  const state = { reasonBox };
  activeStepUp = state;
  const previousClose = dialog.close;
  dialog.close = (options) => {
    if (activeStepUp === state) activeStepUp = null;
    previousClose(options);
  };
  state.afterSignIn = () => {
    password.value = '';
    code.value = '';
    password.focus();
  };
  cancel.addEventListener('click', () => dialog.close());
  (reasonBox ?? password).focus();

  // Enter in a field submits, the reason's text area included.
  reasonBox?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  const showRefusal = (copy) => {
    status.replaceChildren(icon('refuse'), copy);
    status.classList.add('refusal');
    password.value = '';
    code.value = '';
    password.focus();
  };

  let busy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    confirm.disabled = true;
    try {
      status.classList.remove('refusal');
      status.textContent = pending ?? '';
      for (const box of [reasonBox, password, code]) if (box) clearFieldError(box);
      const proofAnswer = await api('POST', '/api/step-up', { body: { password: password.value, code: code.value } });
      if (proofAnswer.status === 401) {
        status.textContent = '';
        return;
      }
      if (proofAnswer.error === 'sign_in_locked') {
        showRefusal('Too many attempts. Try again later.');
        return;
      }
      if (!proofAnswer.ok) {
        showRefusal('Password or code is not right.');
        return;
      }
      const reason = reasonBox ? reasonBox.value : undefined;
      const answer = await run(proofAnswer.data.proof, reason);
      if (answer.status === 401) {
        status.textContent = '';
        return;
      }
      if (answer.status === 422 && answer.errors?.reason && reasonBox) {
        setFieldError(reasonBox, answer.errors.reason);
        status.replaceChildren(icon('refuse'), answer.errors.reason);
        status.classList.add('refusal');
        password.value = '';
        code.value = '';
        reasonBox.focus();
        return;
      }
      dialog.close();
      onAnswer(answer);
    } catch (error) {
      if (!(error instanceof ConnectionLost)) throw error;
      dialog.close();
      onFailure?.(error);
    } finally {
      busy = false;
      confirm.disabled = false;
    }
  });
  return dialog;
}

// Sign in again: the page stays where it is and unsaved work survives.
let signInAgainDialog = null;

export function openSignInAgain() {
  if (signInAgainDialog) return;
  const leave = () => {
    location.assign(`/sign-in?next=${encodeURIComponent(location.pathname)}`);
  };
  const focused = document.activeElement;
  const email = h('input', { type: 'text', readonly: true, value: session.me?.email ?? '' });
  const password = h('input', { type: 'password', autocomplete: 'current-password' });
  const status = h('div', { role: 'status', 'aria-label': 'Sign-in again status', class: 'status-line' },
    'Your session has ended. Sign in to finish what you were doing.');
  const form = h('form', { class: 'stack', novalidate: true },
    field('Email', email),
    field('Password', password),
    status,
    h('div', { class: 'button-row' },
      h('button', { type: 'submit', class: 'btn' }, 'Sign in'),
      h('button', { type: 'button', class: 'btn', onclick: leave }, 'Leave page')));
  const dialog = openDialog({ name: 'Sign in again', content: form, onEscape: leave });
  signInAgainDialog = dialog;
  password.focus();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.classList.remove('refusal');
    status.textContent = 'Signing in.';
    let answer = { ok: false };
    try {
      answer = await api('POST', '/api/sign-in', { body: { email: email.value, password: password.value }, quietSession: true });
    } catch (error) {
      if (!(error instanceof ConnectionLost)) throw error;
    }
    if (!answer.ok) {
      status.replaceChildren(icon('refuse'), answer.error === 'sign_in_locked' ? 'Too many attempts. Try again later.' : 'Email or password is not right.');
      status.classList.add('refusal');
      password.value = '';
      password.focus();
      return;
    }
    session.ended = false;
    signInAgainDialog = null;
    dialog.close({ returnFocus: false });
    if (activeStepUp) activeStepUp.afterSignIn();
    else if (focused?.isConnected) focused.focus();
    signedInAgain();
  });
}
