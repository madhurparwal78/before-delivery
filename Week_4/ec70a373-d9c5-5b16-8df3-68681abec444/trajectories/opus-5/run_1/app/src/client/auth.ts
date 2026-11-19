import { request } from './api';
import { COPY } from './copy';
import { Dialog } from './dialog';
import { button, el, labelled } from './dom';
import { StatusRegion, clearFieldError, showFieldError } from './status';
import { pauseAll, resumeAll } from './timers';

export interface BlockingDialogInfo {
  dialog: Dialog;
  /** Set while the dialog's own action is in flight, so the resume can resend it once. */
  pendingResend: (() => void) | null;
}

let blocking: BlockingDialogInfo | null = null;
let signInAgain: Dialog | null = null;
let currentEmail = '';
let showSignInForm: ((copy: string) => void) | null = null;

export function setBlockingDialog(info: BlockingDialogInfo | null): void {
  blocking = info;
}

export function blockingDialog(): BlockingDialogInfo | null {
  return blocking;
}

export function setSignedInEmail(email: string): void {
  currentEmail = email;
}

export function registerSignInFormHandler(handler: (copy: string) => void): void {
  showSignInForm = handler;
}

/** The single place a 401 is handled, for the plain screen and for an open dialog. */
export function handleUnauthenticated(): void {
  if (signInAgain !== null) return;
  if (blocking !== null && blocking.dialog.isOpen) {
    openSignInAgain(blocking);
    return;
  }
  showSignInForm?.(COPY.sessionEnded);
}

function openSignInAgain(info: BlockingDialogInfo): void {
  pauseAll();
  const focusedBefore = info.dialog.focusedControl();
  info.dialog.setInert(true);
  const status = new StatusRegion('Sign-in status');
  const password = el('input', { type: 'password', autocomplete: 'current-password' });
  const dialog = new Dialog({
    title: 'Sign in again',
    opener: null,
    onEscape: () => {
      void abandon();
    },
  });
  const continueButton = button('Sign in and continue', { class: 'primary' });
  const signOutButton = button('Sign out');
  dialog.body.append(
    el('p', { text: `Signed in as ${currentEmail}` }),
    labelled('Password', password, 'sign-in-again-password'),
    continueButton,
    signOutButton,
    status.element,
  );
  signInAgain = dialog;
  dialog.open(password);
  status.write(COPY.sessionEnded);

  const abandon = async (): Promise<void> => {
    signInAgain = null;
    info.pendingResend = null;
    dialog.close();
    info.dialog.setInert(false);
    info.dialog.close();
    setBlockingDialog(null);
    await request('/api/session', { method: 'DELETE', skipAuthGate: true });
    resumeAll();
    showSignInForm?.(COPY.sessionEnded);
  };

  signOutButton.addEventListener('click', () => {
    void abandon();
  });

  continueButton.addEventListener('click', () => {
    if (continueButton.getAttribute('aria-disabled') === 'true') return;
    clearFieldError(password);
    continueButton.setAttribute('aria-disabled', 'true');
    status.write(COPY.signingIn);
    void request<unknown>('/api/session', {
      method: 'POST',
      body: { email: currentEmail, password: password.value },
      skipAuthGate: true,
    }).then((result) => {
      continueButton.setAttribute('aria-disabled', 'false');
      if (result.ok) {
        signInAgain = null;
        dialog.close();
        info.dialog.setInert(false);
        resumeAll();
        focusedBefore?.focus();
        const resend = info.pendingResend;
        info.pendingResend = null;
        resend?.();
        return;
      }
      if (result.error.code === 'invalid_credentials') {
        status.write(COPY.signInInvalid);
      } else if (result.error.code === 'too_many_attempts') {
        status.write(COPY.signInThrottled(result.retryAfterSeconds));
      } else if (result.error.code === 'validation') {
        const fields = result.error.fields ?? {};
        if (fields.password !== undefined) {
          showFieldError(password, COPY.signInPassword);
          status.write(COPY.signInPassword);
        } else {
          status.write(COPY.signInEmail);
        }
      } else if (result.status === 0) {
        status.write(COPY.offline);
      } else {
        status.write(COPY.internal);
      }
    });
  });
}
