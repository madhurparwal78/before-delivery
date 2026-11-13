import { all, clear, el, find, icon, on } from './dom';
import { send } from './api';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const openDialogs: Dialog[] = [];

/** House rule H7: a modal surface traps Tab, closes on Escape and returns focus. */
export class Dialog {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private readonly opener: HTMLElement | null;
  private readonly inerted: HTMLElement[] = [];

  constructor(title: string, content: (Node | string)[], footer: (Node | string)[]) {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.body = el('div', { class: 'dialog-body' }, content);
    this.root = el(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, class: 'dialog' },
      [
        el('div', { class: 'dialog-panel' }, [
          el('h2', { class: 'dialog-title' }, [title]),
          this.body,
          el('div', { class: 'dialog-footer' }, footer),
        ]),
      ],
    );
    const host = el('div', { class: 'dialog-host' }, [this.root]);
    for (const child of [...document.body.children]) {
      if (child instanceof HTMLElement && child !== host && !child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        this.inerted.push(child);
      }
    }
    document.body.append(host);
    openDialogs.push(this);
    on(this.root, 'keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.key === 'Escape') {
        if (openDialogs[openDialogs.length - 1] === this) {
          keyboard.stopPropagation();
          this.close();
        }
        return;
      }
      if (keyboard.key !== 'Tab') return;
      const items = all(FOCUSABLE, this.root).filter((item) => item.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (keyboard.shiftKey && document.activeElement === first) {
        keyboard.preventDefault();
        last.focus();
      } else if (!keyboard.shiftKey && document.activeElement === last) {
        keyboard.preventDefault();
        first.focus();
      }
    });
    const field = find<HTMLElement>('input, textarea, select', this.root);
    (field ?? find<HTMLElement>('button', this.root))?.focus();
  }

  message(text: string, kind: 'alert' | 'note' = 'note'): void {
    const existing = find('[data-ui="dialog-message"]', this.root);
    existing?.remove();
    const node =
      kind === 'alert'
        ? el('p', { role: 'alert', 'data-ui': 'dialog-message', class: 'dialog-alert' }, [
            icon('alert'),
            text,
          ])
        : el('p', { 'data-ui': 'dialog-message', class: 'dialog-note' }, [text]);
    this.body.append(node);
  }

  close(): void {
    const index = openDialogs.indexOf(this);
    if (index !== -1) openDialogs.splice(index, 1);
    for (const node of this.inerted) node.removeAttribute('inert');
    this.root.parentElement?.remove();
    if (this.opener && this.opener.isConnected) this.opener.focus();
    else find<HTMLElement>('main')?.focus();
  }
}

export function labelledField(
  label: string,
  attrs: Record<string, string> = {},
  tag: 'input' | 'textarea' = 'input',
): { row: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const id = `field-${Math.random().toString(36).slice(2, 8)}`;
  const input =
    tag === 'input'
      ? el('input', { id, type: 'text', ...attrs })
      : el('textarea', { id, rows: '3', ...attrs });
  const row = el('div', { class: 'form-row' }, [el('label', { for: id }, [label]), input]);
  return { row, input: input as HTMLInputElement | HTMLTextAreaElement };
}

export function fieldError(row: HTMLElement, message: string | null): void {
  const existing = find('[data-ui="field-error"]', row);
  existing?.remove();
  const input = find<HTMLInputElement>('input, textarea, select', row);
  if (!message) {
    input?.removeAttribute('aria-invalid');
    return;
  }
  input?.setAttribute('aria-invalid', 'true');
  row.append(el('p', { 'data-ui': 'field-error', class: 'field-error' }, [icon('alert'), message]));
}

export const STORAGE_BANNER = 'Part storage is unreachable. Viewing and discussion still work.';

/** House rule H4: the Storage banner, and controls whose action needs storage. */
export function showStorageBanner(): void {
  if (find('[data-ui="storage-banner"]')) return;
  const banner = el(
    'p',
    { role: 'status', 'aria-label': 'Storage', 'data-ui': 'storage-banner', class: 'storage-banner' },
    [STORAGE_BANNER],
  );
  const main = find<HTMLElement>('main');
  main?.prepend(banner);
  for (const control of all('[data-storage-dependent]')) control.setAttribute('aria-disabled', 'true');
}

export function storageIsDown(): boolean {
  return find('[data-ui="storage-banner"]') !== null;
}

export function markStorageDependent(node: Element): void {
  node.setAttribute('data-storage-dependent', 'true');
  if (storageIsDown()) node.setAttribute('aria-disabled', 'true');
}

export function pageAlert(message: string, extra: (Node | string)[] = []): HTMLElement {
  const main = find<HTMLElement>('main')!;
  const alert = el('div', { role: 'alert', class: 'page-alert' }, [icon('alert'), message, ...extra]);
  main.prepend(alert);
  return alert;
}

export function removeAlerts(): void {
  for (const node of all('.page-alert')) node.remove();
}

export async function checkStorageHealth(): Promise<void> {
  try {
    const answer = await send<{ status: string; storage?: string }>('/api/health');
    if (answer.data.storage === 'down') showStorageBanner();
  } catch {
    /* health is answered by the app itself; a failure shows on the next action */
  }
}

export function wireHeader(): void {
  const button = find<HTMLButtonElement>('[data-ui="sign-out"]');
  if (!button) return;
  on(button, 'click', async () => {
    await send('/api/auth/signout', { method: 'POST' });
    window.location.assign('/');
  });
}

export type LiveHandlers = {
  revision?: (data: Record<string, unknown>) => void;
  comment?: (data: Record<string, unknown>) => void;
  approvals?: (data: Record<string, unknown>) => void;
  like?: (data: Record<string, unknown>) => void;
};

/** The page keeps a server event stream open and reconnects by itself. */
export function openLiveStream(parts: string, handlers: LiveHandlers): EventSource {
  const source = new EventSource(`/api/events?parts=${encodeURIComponent(parts)}`);
  for (const type of ['revision', 'comment', 'approvals', 'like'] as const) {
    source.addEventListener(type, (event) => {
      const handler = handlers[type];
      if (!handler) return;
      handler(JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>);
    });
  }
  return source;
}

export function emptyState(sentence: string, action: Node | null): HTMLElement {
  return el('div', { class: 'empty-state' }, action ? [sentence, action] : [sentence]);
}

export function thumbnail(digest: string | null, alt: string): HTMLElement {
  if (!digest) return el('div', { class: 'thumb thumb-missing' }, ['Preview unavailable']);
  const image = el('img', {
    class: 'thumb',
    src: `/api/solids/${digest}/thumbnail.svg`,
    alt,
    loading: 'lazy',
  });
  on(image, 'error', () => {
    const placeholder = el('div', { class: 'thumb thumb-missing' }, ['Preview unavailable']);
    image.replaceWith(placeholder);
  });
  return image;
}

export function clearNode(node: Element): void {
  clear(node);
}
