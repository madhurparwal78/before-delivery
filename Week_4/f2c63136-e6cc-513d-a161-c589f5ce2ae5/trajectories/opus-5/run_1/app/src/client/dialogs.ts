export interface DialogHandle {
  close: () => void;
}

function focusable(dialog: HTMLElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]',
    ),
  ];
}

let openDialogs = 0;

export function dialogIsOpen(): boolean {
  return openDialogs > 0;
}

/** Opens a modal dialog that traps Tab, closes on Escape and gives focus back to its opener. */
export function openDialog(options: {
  label: string;
  content: DocumentFragment | HTMLElement;
  opener: HTMLElement | null;
  onSubmit: () => void;
  onClose?: () => void;
  focusFirst?: string;
}): DialogHandle {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', options.label);
  dialog.append(options.content);
  document.body.append(dialog);
  openDialogs += 1;

  const close = () => {
    if (!dialog.isConnected) return;
    openDialogs = Math.max(0, openDialogs - 1);
    dialog.close();
    dialog.remove();
    if (options.onClose) options.onClose();
    if (options.opener && options.opener.isConnected) options.opener.focus();
  };

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      options.onSubmit();
      return;
    }
    if (event.key === 'Tab') {
      const items = focusable(dialog);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  dialog.showModal();
  const target = options.focusFirst
    ? dialog.querySelector<HTMLElement>(options.focusFirst)
    : focusable(dialog)[0] ?? null;
  if (target) target.focus();
  return { close };
}

export function labelledField(
  kind: 'text' | 'textarea' | 'number',
  label: string,
  attributes: Record<string, string> = {},
): HTMLElement {
  const holder = document.createElement('label');
  holder.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  const input =
    kind === 'textarea' ? document.createElement('textarea') : (document.createElement('input') as HTMLInputElement);
  if (kind !== 'textarea') (input as HTMLInputElement).type = kind === 'number' ? 'number' : 'text';
  input.setAttribute('aria-label', label);
  for (const [name, value] of Object.entries(attributes)) input.setAttribute(name, value);
  holder.append(span, input);
  return holder;
}

export function actionRow(buttons: HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dialogactions';
  row.append(...buttons);
  return row;
}

export function button(text: string, className = 'flat'): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;
  return element;
}
