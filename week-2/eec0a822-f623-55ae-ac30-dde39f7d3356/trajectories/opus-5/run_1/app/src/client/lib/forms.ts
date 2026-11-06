import { announce } from './live.js';
import { clear, el, fill } from './dom.js';

export interface FieldEntry {
  readonly name: string;
  readonly label: string;
  readonly control: HTMLElement;
  readonly errorHost: HTMLElement;
}

let fieldCounter = 0;

export class FieldSet {
  private readonly entries: FieldEntry[] = [];
  readonly problems: HTMLElement;

  constructor(readonly inDialog = false) {
    this.problems = el('div', { class: 'problems', role: 'region', 'aria-label': 'Problems', hidden: true });
  }

  field(name: string, label: string, control: HTMLElement, hint?: string): HTMLElement {
    fieldCounter += 1;
    const controlId = control.id === '' ? `field-${fieldCounter}` : control.id;
    control.id = controlId;
    const errorHost = el('p', { class: 'field-error', id: `${controlId}-error` });
    const wrapper = el(
      'div',
      { class: 'field' },
      el('label', { class: 'field-label', for: controlId }, label),
      hint === undefined ? null : el('p', { class: 'field-hint' }, hint),
      control,
      errorHost,
    );
    this.entries.push({ name, label, control, errorHost });
    return wrapper;
  }

  register(name: string, label: string, control: HTMLElement, errorHost: HTMLElement): void {
    this.entries.push({ name, label, control, errorHost });
  }

  clearErrors(): void {
    for (const entry of this.entries) {
      entry.errorHost.textContent = '';
      entry.control.removeAttribute('aria-invalid');
      entry.control.removeAttribute('aria-describedby');
    }
    clear(this.problems);
    this.problems.hidden = true;
  }

  /** Shows each 422 message inline and, outside dialogs, in the Problems summary. */
  showErrors(errors: Record<string, string>): HTMLElement | null {
    this.clearErrors();
    let firstControl: HTMLElement | null = null;
    const links: HTMLElement[] = [];
    for (const entry of this.entries) {
      const message = errors[entry.name];
      if (message === undefined) continue;
      entry.errorHost.textContent = message;
      entry.control.setAttribute('aria-invalid', 'true');
      entry.control.setAttribute('aria-describedby', entry.errorHost.id);
      if (firstControl === null) firstControl = entry.control;
      links.push(
        el('li', {}, el(
          'a',
          {
            class: 'problem-link',
            href: `#${entry.control.id}`,
            onclick: (event: Event) => {
              event.preventDefault();
              entry.control.focus();
            },
          },
          `${entry.label}: ${message}`,
        )),
      );
    }
    if (!this.inDialog && links.length > 0) {
      fill(this.problems, el('h2', { class: 'problems-heading' }, 'Problems'), el('ul', {}, ...links));
      this.problems.hidden = false;
    }
    return firstControl;
  }
}

export interface MessageBox {
  /** The area holding the message and any follow-up control. */
  readonly node: HTMLElement;
  /** Holds a follow-up control, kept out of the message's own text. */
  readonly extra: HTMLElement;
  show(message: string, tone?: 'ok' | 'problem'): void;
  clear(): void;
}

export function createMessageBox(): MessageBox {
  const message = el('p', { class: 'action-message' });
  const extra = el('p', { class: 'action-extra' });
  const node = el('div', { class: 'action-message-area' }, message, extra);
  return {
    node,
    extra,
    show(text: string, tone: 'ok' | 'problem' = 'ok'): void {
      message.textContent = text;
      message.className = `action-message is-${tone}`;
      extra.replaceChildren();
      announce(text);
    },
    clear(): void {
      message.textContent = '';
      message.className = 'action-message';
      extra.replaceChildren();
    },
  };
}

interface HandOff {
  readonly message: string;
  readonly tone: 'ok' | 'problem';
}

let handOff: HandOff | null = null;

/** Carries an action's message to the screen the action opens. */
export function handOffMessage(message: string, tone: 'ok' | 'problem' = 'ok'): void {
  handOff = { message, tone };
}

export function takeHandOffMessage(box: MessageBox): void {
  if (handOff === null) return;
  box.show(handOff.message, handOff.tone);
  handOff = null;
}

/** Runs an action with its pending label, keeping the button a single submit. */
export async function withPending(
  button: HTMLButtonElement,
  pendingLabel: string,
  run: () => Promise<void>,
): Promise<void> {
  const original = button.textContent ?? '';
  button.disabled = true;
  button.textContent = pendingLabel;
  announce(pendingLabel);
  try {
    await run();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
