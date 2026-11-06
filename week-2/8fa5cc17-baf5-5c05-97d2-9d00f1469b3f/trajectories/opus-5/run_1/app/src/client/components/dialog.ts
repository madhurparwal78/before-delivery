import { el, focusable, setOutsideInert, trapFocus } from '../dom';

export type DialogHandle = {
  node: HTMLElement;
  close: () => void;
  isOpen: () => boolean;
};

export type DialogOptions = {
  label: string;
  role?: 'dialog' | 'alertdialog';
  className?: string;
  opener: HTMLElement | null;
  content: (handle: DialogHandle) => Node[];
  onClose?: () => void;
};

/** Every dialog keeps Tab inside it, closes on Escape and returns focus to its opener. */
export function openDialog(options: DialogOptions): DialogHandle {
  const backdrop = el('div', { className: 'dialog-backdrop' });
  const node = el('div', {
    className: `dialog ${options.className ?? ''}`.trim(),
    attrs: {
      role: options.role ?? 'dialog',
      'aria-modal': 'true',
      'aria-label': options.label,
    },
  });
  let open = true;
  const handle: DialogHandle = {
    node,
    isOpen: () => open,
    close: () => {
      if (!open) return;
      open = false;
      setOutsideInert(false, []);
      backdrop.remove();
      node.remove();
      if (options.onClose !== undefined) options.onClose();
      if (options.opener !== null && document.contains(options.opener)) options.opener.focus();
    },
  };
  node.append(...options.content(handle));
  trapFocus(node);
  node.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') {
      event.stopPropagation();
      handle.close();
    }
  });
  backdrop.addEventListener('click', () => handle.close());
  setOutsideInert(true, []);
  document.body.append(backdrop, node);
  const first = focusable(node)[0];
  if (first !== undefined) first.focus();
  return handle;
}
