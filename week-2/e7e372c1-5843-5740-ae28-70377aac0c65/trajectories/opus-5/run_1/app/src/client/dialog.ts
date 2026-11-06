/**
 * Modal dialogs. Each opening starts a new dialog session; a response that
 * arrives after its session closed never writes into a session opened since.
 */
import { containFocus, element, prefersReducedMotion } from './dom';

const FADE_MS = 170;

export interface DialogSession {
  readonly id: number;
  readonly body: HTMLElement;
  isCurrent(): boolean;
  close(): void;
}

export class ModalDialog {
  private nextSessionId = 1;

  private openSessionId = 0;

  private root: HTMLElement | null = null;

  /** Roots still fading out, removed the moment the dialog is reopened. */
  private readonly closingRoots = new Set<HTMLElement>();

  constructor(
    private readonly label: string,
    private readonly build: (session: DialogSession) => HTMLElement,
  ) {}

  isOpen(): boolean {
    return this.root !== null;
  }

  currentSessionId(): number {
    return this.openSessionId;
  }

  open(opener: HTMLElement): DialogSession {
    this.removeRoot();
    const id = this.nextSessionId;
    this.nextSessionId += 1;
    this.openSessionId = id;

    const body = element('div', { className: 'dialog-body' });
    const root = element('div', {
      className: 'dialog-backdrop',
      children: [
        element('div', {
          className: 'dialog-panel',
          attributes: { role: 'dialog', 'aria-modal': 'true', 'aria-label': this.label },
          children: [body],
        }),
      ],
    });
    this.root = root;

    const session: DialogSession = {
      id,
      body,
      isCurrent: () => this.openSessionId === id && this.root === root,
      close: () => {
        if (this.openSessionId !== id || this.root !== root) return;
        this.openSessionId = 0;
        this.root = null;
        this.closingRoots.add(root);
        root.classList.remove('dialog-open');
        root.inert = true;
        const finish = (): void => {
          this.closingRoots.delete(root);
          root.remove();
        };
        if (prefersReducedMotion()) finish();
        else window.setTimeout(finish, FADE_MS);
        opener.focus();
      },
    };

    const firstFocus = this.build(session);
    document.body.appendChild(root);
    const panel = root.querySelector<HTMLElement>('.dialog-panel');
    panel?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        session.close();
        return;
      }
      containFocus(panel, event);
    });
    if (prefersReducedMotion()) root.classList.add('dialog-open', 'dialog-reduced');
    else requestAnimationFrame(() => root.classList.add('dialog-open'));
    firstFocus.focus();
    return session;
  }

  private removeRoot(): void {
    for (const closing of this.closingRoots) closing.remove();
    this.closingRoots.clear();
    if (this.root === null) return;
    this.root.remove();
    this.root = null;
    this.openSessionId = 0;
  }
}
