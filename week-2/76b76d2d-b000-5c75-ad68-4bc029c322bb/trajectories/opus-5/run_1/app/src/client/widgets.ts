export function initOptionMenu(
  opener: HTMLElement,
  list: HTMLElement,
  onChoose: (value: string, option: HTMLElement) => void,
  valueAttribute: string,
): void {
  const options = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));

  const close = (focusOpener: boolean): void => {
    list.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    if (focusOpener) opener.focus();
  };

  const open = (): void => {
    list.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    const selected = options().find((option) => option.getAttribute('aria-selected') === 'true') ?? options()[0];
    selected?.focus();
  };

  opener.addEventListener('click', () => {
    if (list.hidden) open();
    else close(true);
  });
  opener.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });

  for (const option of options()) {
    option.tabIndex = -1;
    option.addEventListener('click', () => {
      onChoose(option.getAttribute(valueAttribute) ?? '', option);
      close(true);
    });
    option.addEventListener('keydown', (event) => {
      const list_ = options();
      const index = list_.indexOf(option);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        list_[Math.min(list_.length - 1, index + 1)].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        list_[Math.max(0, index - 1)].focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onChoose(option.getAttribute(valueAttribute) ?? '', option);
        close(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Tab') {
        close(false);
      }
    });
  }
}

export function openDialog(dialog: HTMLElement, opener: HTMLElement | null): void {
  dialog.hidden = false;
  dialog.setAttribute('data-opener', opener?.id ?? '');
  const focusable = dialog.querySelectorAll<HTMLElement>('input, textarea, button, select');
  const field = dialog.querySelector<HTMLElement>('input, textarea, select');
  (field ?? focusable[0])?.focus();
  const trap = (event: KeyboardEvent): void => {
    if (dialog.hidden) {
      document.removeEventListener('keydown', trap);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog(dialog);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('input, textarea, button, select')).filter(
      (item) => !item.hasAttribute('disabled'),
    );
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
  };
  document.addEventListener('keydown', trap);
}

export function closeDialog(dialog: HTMLElement): void {
  dialog.hidden = true;
  const openerId = dialog.getAttribute('data-opener');
  if (openerId !== null && openerId !== '') document.getElementById(openerId)?.focus();
}
