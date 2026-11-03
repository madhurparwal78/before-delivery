const TOAST_MS = 4000;

let toast: HTMLElement | undefined;
let toastTimer: number | undefined;

function announcer(): HTMLElement {
  const node = document.getElementById('announcer');
  if (node) return node;
  const made = document.createElement('div');
  made.id = 'announcer';
  made.setAttribute('role', 'status');
  made.setAttribute('aria-live', 'polite');
  made.setAttribute('data-announcement-count', '0');
  document.body.append(made);
  return made;
}

/** The only live region: every notice is announced here, once per call. */
export function announce(text: string): void {
  const node = announcer();
  node.textContent = '';
  node.textContent = text;
  const count = Number(node.getAttribute('data-announcement-count') ?? '0') + 1;
  node.setAttribute('data-announcement-count', String(count));
}

export function announceWithToast(text: string): void {
  announce(text);
  showToast(text);
}

export function showToast(text: string): void {
  if (!toast) {
    toast = document.createElement('div');
    toast.setAttribute('data-toast', '');
    toast.setAttribute('aria-hidden', 'true');
    document.body.append(toast);
  }
  toast.textContent = text;
  toast.hidden = false;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toast) toast.hidden = true;
  }, TOAST_MS);
}
