import { el } from '../dom.js';
import { DURATION, reducedMotion } from '../motion.js';

export interface DialogHandle {
  close: () => void;
  panel: HTMLElement;
}

export interface DialogOptions {
  label: string;
  kind?: 'dialog' | 'alertdialog';
  className?: string;
  host?: HTMLElement;
  onClose?: () => void;
}

function focusFirst(panel: HTMLElement): void {
  const control = panel.querySelector<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  control?.focus();
}

export function openDialog(options: DialogOptions, children: readonly Node[]): DialogHandle {
  const opener = document.activeElement as HTMLElement | null;
  const panel = el('div', {
    role: options.kind ?? 'dialog',
    'aria-label': options.label,
    'aria-modal': 'true',
    class: `dialog ${options.className ?? ''}`.trim(),
  });
  panel.append(el('h2', { class: 'dialog-title' }, [options.label]), ...children);
  const host = options.host ?? document.body;
  if (options.host === undefined) {
    const backdrop = el('div', { class: 'dialog-backdrop' }, [panel]);
    host.append(backdrop);
  } else {
    host.append(panel);
  }
  if (!reducedMotion()) {
    panel.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: DURATION.step, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }
  const close = (): void => {
    const remove = (): void => {
      (options.host === undefined ? (panel.parentElement ?? panel) : panel).remove();
      options.onClose?.();
      opener?.focus();
    };
    if (reducedMotion()) {
      remove();
      return;
    }
    const leaving = panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION.press });
    leaving.addEventListener('finish', remove);
  };
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  });
  focusFirst(panel);
  return { close, panel };
}
