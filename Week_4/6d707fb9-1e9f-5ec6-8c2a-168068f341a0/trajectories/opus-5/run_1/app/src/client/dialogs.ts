import { pick, pickAll, reducedMotion } from './dom';

interface Open {
  element: HTMLElement;
  opener: HTMLElement | null;
}

const stack: Open[] = [];
const closing = new Map<HTMLElement, number>();

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openCount(): number {
  return stack.length;
}

export function isOpen(element: HTMLElement): boolean {
  return stack.some((entry) => entry.element === element);
}

function focusables(element: HTMLElement): HTMLElement[] {
  return pickAll<HTMLElement>(FOCUSABLE, element).filter(
    (found) => found.offsetParent !== null || found === document.activeElement,
  );
}

/** Opening a dialog moves focus inside it to its first field on every opening. */
export function openDialog(element: HTMLElement, opener: HTMLElement | null): void {
  const pending = closing.get(element);
  if (pending !== undefined) {
    window.clearTimeout(pending);
    closing.delete(element);
  }
  element.hidden = false;
  element.removeAttribute('inert');
  element.setAttribute('data-open', 'true');
  element.setAttribute('data-keep', 'true');
  element.classList.remove('closing');
  element.classList.add('open');
  if (!isOpen(element)) stack.push({ element, opener });
  const inside = focusables(element);
  const firstField = inside.find((found) =>
    ['INPUT', 'SELECT', 'TEXTAREA'].includes(found.tagName),
  );
  (firstField ?? inside[0] ?? element).focus();
}

export function closeTop(): void {
  const top = stack.pop();
  if (!top) return;
  closeElement(top.element);
  const opener = top.opener;
  if (opener && opener.isConnected) opener.focus();
  else {
    const heading = pick<HTMLElement>('#page-heading');
    if (heading) heading.focus();
  }
}

export function closeDialog(element: HTMLElement): void {
  const at = stack.findIndex((entry) => entry.element === element);
  if (at === -1) return;
  const entry = stack.splice(at, 1)[0] as Open;
  closeElement(element);
  const opener = entry.opener;
  if (opener && opener.isConnected) opener.focus();
  else {
    const heading = pick<HTMLElement>('#page-heading');
    if (heading) heading.focus();
  }
}

function closeElement(element: HTMLElement): void {
  element.removeAttribute('data-open');
  element.removeAttribute('data-keep');
  element.setAttribute('inert', '');
  element.classList.remove('open');
  if (reducedMotion()) {
    element.classList.remove('closing');
    element.hidden = true;
    return;
  }
  element.classList.add('closing');
  const timer = window.setTimeout(() => {
    element.classList.remove('closing');
    element.hidden = true;
    closing.delete(element);
  }, 320);
  closing.set(element, timer);
}

/** Every dialog keeps Tab and Shift+Tab inside it. */
export function trapTab(event: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  const inside = focusables(top.element);
  if (inside.length === 0) {
    event.preventDefault();
    top.element.focus();
    return;
  }
  const first = inside[0] as HTMLElement;
  const last = inside[inside.length - 1] as HTMLElement;
  const active = document.activeElement as HTMLElement | null;
  if (!top.element.contains(active)) {
    event.preventDefault();
    first.focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function topDialog(): HTMLElement | null {
  const top = stack[stack.length - 1];
  return top ? top.element : null;
}
