export type Me = { id: number; username: string; time_zone: string };

export type AppState = {
  me: Me | null;
  pending: number;
  seq: number;
  toastMs: number;
  storageDown: boolean;
  stripText: string;
};

export const state: AppState = {
  me: null,
  pending: 0,
  seq: 0,
  toastMs: 5000,
  storageDown: false,
  stripText: 'Spurline is running on Postgres and file storage.',
};

export function mainElement(): HTMLElement | null {
  return document.querySelector('main');
}

export function syncMainAttributes(): void {
  const main = mainElement();
  if (main === null) return;
  main.dataset.seq = String(state.seq);
  main.dataset.pending = String(state.pending);
}

export function announce(text: string): void {
  const region = document.getElementById('announcements');
  if (region !== null) region.textContent = text;
  const notifications = document.getElementById('notifications');
  if (notifications === null) return;
  const toast = document.createElement('p');
  toast.className = 'toast';
  toast.textContent = text;
  notifications.append(toast);
  window.setTimeout(() => toast.remove(), state.toastMs);
}

export function startPending(control?: HTMLButtonElement | null): void {
  state.pending += 1;
  syncMainAttributes();
  if (control !== null && control !== undefined) {
    control.disabled = true;
    control.setAttribute('aria-busy', 'true');
  }
}

export function endPending(control?: HTMLButtonElement | null): void {
  state.pending = Math.max(0, state.pending - 1);
  syncMainAttributes();
  if (control !== null && control !== undefined) {
    control.disabled = false;
    control.removeAttribute('aria-busy');
  }
}
