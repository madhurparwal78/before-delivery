export type El = HTMLElement;

/** Creates an element with attributes and children in one call. */
export function h<T extends HTMLElement = HTMLElement>(tag: string, attrs: Record<string, unknown> = {}, ...children: (Node | string | null | undefined)[]): T {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.setAttribute('class', String(value));
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value as Record<string, string>)) node.dataset[k] = v;
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node as T;
}

/** Announces a message exactly once per event in the Announcements region. */
export function announce(message: string): void {
  const region = document.querySelector('status[aria-label="Announcements"], [role="status"][aria-label="Announcements"]');
  if (region) {
    region.textContent = '';
    window.setTimeout(() => {
      region.textContent = message;
    }, 30);
  }
}

/** Traps Tab inside a dialog and closes it on Escape, returning focus to its opener. */
export function trapFocus(dialog: El, onClose: () => void): void {
  const focusables = (): HTMLElement[] =>
    Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((e) => !e.hasAttribute('disabled'));
  const handler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  dialog.addEventListener('keydown', handler);
  const close = (): void => {
    dialog.removeEventListener('keydown', handler);
    onClose();
  };
}

export function openDialog(build: (close: () => void) => El | Promise<El>, opener: HTMLElement | null): void {
  const previous = opener ?? (document.activeElement as HTMLElement | null);
  const overlay = h('div', { class: 'overlay', role: 'presentation' });
  const close = (): void => {
    overlay.remove();
    if (previous) previous.focus();
  };
  void Promise.resolve(build(close)).then((built) => {
    overlay.append(built);
    document.body.append(overlay);
    trapFocus(built, close);
    const firstInput = built.querySelector<HTMLElement>('input, textarea, button');
    if (firstInput) firstInput.focus();
  });
}

export function openAlertDialog(title: string, body: El, confirmLabel: string, onConfirm: () => void, opener: HTMLElement | null, pendingLabel?: string): void {
  openDialog((close) => {
    const confirmBtn = h('button', { class: 'primary', type: 'button', text: confirmLabel, onclick: async () => {
      confirmBtn.setAttribute('disabled', 'true');
      if (pendingLabel) confirmBtn.textContent = pendingLabel;
      await onConfirm();
      close();
    } });
    const cancelBtn = h('button', { type: 'button', text: 'Cancel', onclick: close });
    const dlg = h('div', { class: 'alert-dialog', role: 'alertdialog', 'aria-label': title },
      h('h2', { text: title }),
      body,
      h('div', { class: 'row' }, cancelBtn, confirmBtn),
    );
    window.setTimeout(() => cancelBtn.focus(), 10);
    return dlg;
  }, opener);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function roleLabel(role: string): string {
  return role === 'owner' ? 'Owner' : role === 'editor' ? 'Editor' : role === 'commenter' ? 'Commenter' : 'Viewer';
}
