const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableInside(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export type Trap = { release: () => void };

/**
 * Keeps Tab inside an open dialog or sheet and sends Escape to the closer, which returns
 * focus to the control that opened it.
 */
export function trapFocus(container: HTMLElement, onEscape: () => void): Trap {
  const handler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = focusableInside(container);
    if (stops.length === 0) return;
    const first = stops[0] as HTMLElement;
    const last = stops[stops.length - 1] as HTMLElement;
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', handler);
  return { release: () => container.removeEventListener('keydown', handler) };
}

export function focusFirst(container: HTMLElement): void {
  const stops = focusableInside(container);
  stops[0]?.focus();
}

export function focusByName(container: ParentNode, focusId: string | null): boolean {
  if (!focusId) return false;
  const target = container.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`);
  if (!target) return false;
  target.focus();
  return true;
}

export function focusIdOf(node: Element | null): string | null {
  if (!node) return null;
  const owner = node.closest<HTMLElement>('[data-focus-id]');
  return owner?.dataset['focusId'] ?? null;
}
