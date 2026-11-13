import { button, el } from '../dom.js';

export type DialogSpec = {
  title: string;
  content: (Node | string)[];
  submitLabel: string;
  onSubmit: () => void | Promise<void>;
};

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/** Opens a modal dialog that keeps Tab inside it, closes on Escape and returns focus on close. */
export function openDialog(spec: DialogSpec): void {
  const opener = document.activeElement as HTMLElement | null;
  const submit = button(spec.submitLabel, { class: 'primary' });
  const cancel = button('Cancel');
  const panel = el(
    'div',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.title, class: 'dialog' },
    [
      el('h2', { class: 'dialog-title', text: spec.title }),
      el('div', { class: 'dialog-body' }, spec.content),
      el('div', { class: 'dialog-actions' }, [submit, cancel]),
    ],
  );
  const overlay = el('div', { class: 'dialog-overlay' }, [panel]);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    if (opener !== null && document.contains(opener)) opener.focus();
  };

  const focusable = (): HTMLElement[] =>
    [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => !node.hasAttribute('disabled'),
    );

  function onKeyDown(event: KeyboardEvent): void {
    if (!overlay.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === 'Enter') {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement &&
        panel.contains(active) &&
        active.type !== 'checkbox' &&
        active.type !== 'radio'
      ) {
        event.preventDefault();
        void run();
      }
    }
  }

  async function run(): Promise<void> {
    close();
    await spec.onSubmit();
  }

  submit.addEventListener('click', () => {
    void run();
  });
  cancel.addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown, true);
  document.body.append(overlay);
  const items = focusable();
  const firstField = panel.querySelector<HTMLElement>('input, select, textarea');
  (firstField ?? items[0] ?? panel).focus();
}
