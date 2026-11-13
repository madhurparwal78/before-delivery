/** App state, notices, dialogs and shared UI helpers. */
import { api, ApiFailure, type User, type Preferences } from './api.ts';

export interface AppShell {
  user: User | null;
  preferences: Preferences;
  notices: (text: string) => void;
  serviceNotice: (text: string) => void;
  refreshHeader: () => void;
}

export const shell: AppShell = {
  user: null,
  preferences: { motion: true, sound: false },
  notices: notice,
  serviceNotice: serviceNotice,
  refreshHeader: refreshHeader,
};

export function notice(text: string): void {
  const region = document.querySelector<HTMLDivElement>('[role="status"].notices, .notice-region');
  if (region) {
    region.textContent = text;
    window.setTimeout(() => {
      if (region.textContent === text) region.textContent = '';
    }, 6000);
  }
}

export function serviceNotice(text: string): void {
  const region = document.querySelector<HTMLDivElement>('.service-notice');
  if (region) {
    region.textContent = text;
    region.hidden = !text;
  }
}

export async function loadSession(): Promise<void> {
  try {
    const me = await api.get<{ user: User; preferences: Preferences }>('/api/me');
    shell.user = me.user;
    shell.preferences = me.preferences;
  } catch {
    shell.user = null;
    shell.preferences = { motion: true, sound: false };
  }
  refreshHeader();
  applyMotionClass();
}

export function applyMotionClass(): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionOn = shell.user ? shell.preferences.motion : !reduced;
  document.documentElement.classList.toggle('no-motion', !motionOn);
}

export function motionEnabled(): boolean {
  if (document.documentElement.classList.contains('no-motion')) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches || (shell.user !== null && shell.preferences.motion);
}

export async function setPreference(motion: boolean, sound: boolean): Promise<void> {
  shell.preferences = { motion, sound };
  applyMotionClass();
  if (shell.user) {
    try {
      const res = await api.put<{ preferences: Preferences }>('/api/me/preferences', { motion, sound });
      shell.preferences = res.preferences;
    } catch {
      /* preferences unavailable: kept in the page */
    }
  }
}

function refreshHeader(): void {
  const signIn = document.querySelector<HTMLButtonElement>('[data-action="sign-in"]');
  const account = document.querySelector<HTMLAnchorElement>('[data-action="account"]');
  const signOut = document.querySelector<HTMLButtonElement>('[data-action="sign-out"]');
  const personName = document.querySelector<HTMLSpanElement>('[data-id="person-name"]');
  if (shell.user) {
    if (signIn) signIn.hidden = true;
    if (account) {
      account.hidden = false;
      if (personName) personName.textContent = shell.user.name;
    }
    if (signOut) signOut.hidden = false;
  } else {
    if (signIn) signIn.hidden = false;
    if (account) account.hidden = true;
    if (signOut) signOut.hidden = true;
  }
}

/** A modal dialog that keeps Tab inside itself, closes on Escape and restores focus. */
export function openDialog(id: string, opener: HTMLElement | null): void {
  const dialog = document.querySelector<HTMLDialogElement>(`#${id}`);
  if (!dialog) return;
  (dialog as HTMLDialogElement & { _opener?: HTMLElement | null })._opener = opener;
  dialog.removeAttribute('aria-hidden');
  dialog.classList.remove('not-open');
  dialog.showModal();
  const focusable = focusableElements(dialog);
  const firstControl = focusable[0];
  const heading = dialog.querySelector('h2');
  if (firstControl instanceof HTMLElement) firstControl.focus();
  else if (heading) heading.setAttribute('tabindex', '-1'), heading.focus();
}

export function closeDialog(id: string): void {
  const dialog = document.querySelector<HTMLDialogElement>(`#${id}`);
  if (!dialog) return;
  dialog.setAttribute('aria-hidden', 'true');
  dialog.classList.add('not-open');
  dialog.close();
  const opener = (dialog as HTMLDialogElement & { _opener?: HTMLElement | null })._opener ?? null;
  if (opener && document.contains(opener)) opener.focus();
  else if (id === 'dialog-book') {
    // The booking dialog exception: focus goes to the session card.
    const card = document.querySelector<HTMLElement>('[data-session-card]');
    if (card) card.focus();
  }
}

/** Wire a dialog for keyboard trapping and Escape. */
export function wireDialogs(): void {
  for (const dialog of Array.from(document.querySelectorAll<HTMLDialogElement>('dialog'))) {
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(dialog.id);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey) {
        if (document.activeElement === first || !dialog.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog.id);
    });
    for (const btn of Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-close]'))) {
      btn.addEventListener('click', () => closeDialog(dialog.id));
    }
  }
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  const selector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function errorSummary(dialog: HTMLElement, message: string, fields?: Record<string, string>): void {
  const alert = dialog.querySelector<HTMLDivElement>('[data-role="alert"]');
  if (!alert) return;
  alert.textContent = '';
  if (fields && Object.keys(fields).length) {
    const ul = document.createElement('ul');
    ul.className = 'alert-list';
    for (const [field, text] of Object.entries(fields)) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = text;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = dialog.querySelector<HTMLElement>(`[data-field="${field}"], [name="${field}"]`);
        if (target) target.focus();
      });
      li.appendChild(a);
      alert.appendChild(li);
    }
  } else {
    alert.textContent = message;
  }
  alert.hidden = false;
}

export function clearErrorSummary(dialog: HTMLElement): void {
  const alert = dialog.querySelector<HTMLDivElement>('[data-role="alert"]');
  if (alert) {
    alert.textContent = '';
    alert.hidden = true;
  }
}

export function fieldError(field: string, message: string): void {
  const el = document.querySelector<HTMLElement>(`[data-field-error="${field}"]`);
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

export function isApiFailure(e: unknown): e is ApiFailure {
  return e instanceof ApiFailure;
}

/** Render an error's message into a live region and return it. */
export function announceError(e: unknown, fallback: string): string {
  if (e instanceof ApiFailure) return e.message;
  return fallback;
}

/** The idempotency key kept for one set of Donate field values. */
export class DonateKey {
  private key = newIdempotencyKey();
  private signature = '';

  updateSignature(sig: string): string {
    if (sig !== this.signature) {
      this.signature = sig;
      this.key = newIdempotencyKey();
    }
    return this.key;
  }

  current(): string {
    return this.key;
  }
}

export function newIdempotencyKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  let out = '';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
