/**
 * The one Announcements region, the Refresh state line and the Problems
 * summary, plus the pending state every button shows while its request is open.
 */
import { F } from '../../shared/feedback.ts';
import { need, setHidden, setText, el } from './dom.ts';

let announcements: HTMLElement | null = null;
let refreshState: HTMLElement | null = null;

function announcementsRegion(): HTMLElement {
  announcements ??= need<HTMLElement>('#announcements');
  return announcements;
}

function refreshRegion(): HTMLElement {
  refreshState ??= need<HTMLElement>('#refresh-state');
  return refreshState;
}

/**
 * One message made twice in a row is announced twice, so the region's content
 * changes each time.
 */
export function announce(message: string): void {
  const region = announcementsRegion();
  region.textContent = '';
  region.append(el('p', { text: message }));
}

export function clearAnnouncement(): void {
  announcementsRegion().textContent = '';
}

/** Holds only F-02, with its space reserved under the top bar. */
export function showRefreshFailed(message = F.refreshFailed): void {
  setText(refreshRegion(), message);
}

export function clearRefreshFailed(): void {
  setText(refreshRegion(), '');
}

/** `Sign in again` shows in the Refresh state's place and in the open dialog. */
export function showSessionEnded(returnTo: string): void {
  const region = refreshRegion();
  region.textContent = '';
  region.append(el('a', { href: `/sign-in?returnTo=${encodeURIComponent(returnTo)}`, text: 'Sign in again' }));
}

// ------------------------------------------------------------------ problems

export interface FieldProblem {
  field: string;
  message: string;
}

/** One link per refused field, whose text is that field's message. */
export function showProblems(
  region: HTMLElement,
  problems: readonly FieldProblem[],
  fieldOf: (name: string) => HTMLElement | null,
  heading: string,
): void {
  const list = need('ul', region);
  list.textContent = '';
  for (const problem of problems) {
    const target = fieldOf(problem.field);
    const link = el('a', { href: `#${target?.id ?? ''}`, text: problem.message });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      target?.focus();
    });
    list.append(el('li', {}, [link]));
    if (target) {
      target.setAttribute('aria-invalid', 'true');
      let description = document.getElementById(`${target.id}-error`);
      if (!description) {
        description = el('span', { id: `${target.id}-error`, class: 'field-error' });
        target.insertAdjacentElement('afterend', description);
      }
      description.textContent = problem.message;
      target.setAttribute('aria-describedby', description.id);
    }
  }
  const title = region.querySelector('h2');
  if (title) setText(title, heading);
  setHidden(region, problems.length === 0);
  if (problems.length > 0) {
    const first = region.querySelector<HTMLElement>('a');
    first?.focus();
  }
}

export function clearProblems(region: HTMLElement, fields: readonly HTMLElement[]): void {
  const list = region.querySelector('ul');
  if (list) list.textContent = '';
  setHidden(region, true);
  for (const field of fields) {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
    document.getElementById(`${field.id}-error`)?.remove();
  }
}

// ------------------------------------------------------------ pending states

const pendingNames = new WeakMap<HTMLElement, string>();

/**
 * While a button's request is open its visible text and its accessible name
 * both read F-01, it carries aria-disabled and focus stays on it.
 */
export function setPending(button: HTMLElement, pending: boolean, busyText: string = F.working): void {
  if (pending) {
    if (pendingNames.has(button)) return;
    pendingNames.set(button, button.textContent ?? '');
    button.textContent = busyText;
    button.setAttribute('aria-disabled', 'true');
    return;
  }
  const name = pendingNames.get(button);
  if (name === undefined) return;
  pendingNames.delete(button);
  button.textContent = name;
  button.removeAttribute('aria-disabled');
}

export function isPending(button: HTMLElement): boolean {
  return pendingNames.has(button);
}

/** Runs the work with the button in its pending state, keeping focus on it. */
export async function withPending<T>(
  button: HTMLElement,
  work: () => Promise<T>,
  busyText?: string,
): Promise<T | undefined> {
  if (isPending(button)) return undefined;
  setPending(button, true, busyText);
  try {
    return await work();
  } finally {
    setPending(button, false);
  }
}
