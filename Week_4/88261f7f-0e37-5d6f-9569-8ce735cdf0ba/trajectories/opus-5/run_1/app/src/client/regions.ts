import { el } from './dom';

export const regionNames = {
  signIn: 'Sign-in status',
  deskNotices: 'Desk notices',
  closeStatus: 'Close status',
  boardStatus: 'Board status',
  folioStatus: 'Folio status',
  ratesStatus: 'Rates status',
  checkInStatus: 'Check-in status',
  businessDate: 'Business date',
  freeRooms: 'Free rooms',
  stayTotal: 'Stay total',
  cancellationTerms: 'Cancellation terms',
} as const;

const messages = new Map<string, string>();
const awaitingOutcome = new Set<string>();

/** A message stays until the next one for that region; no repaint or pushed change clears it. */
export function setMessage(name: string, text: string): void {
  if (text.endsWith('\u2026')) awaitingOutcome.add(name);
  else awaitingOutcome.delete(name);
  messages.set(name, text);
  for (const node of document.querySelectorAll<HTMLElement>(`[data-region="${cssEscape(name)}"]`)) {
    node.textContent = text;
  }
}

function messageFor(name: string): string {
  return messages.get(name) ?? '';
}

/** A pushed notice never overwrites the outcome a request on this screen is still waiting for. */
export function applyPushedMessage(name: string, text: string): void {
  if (awaitingOutcome.has(name)) return;
  setMessage(name, text);
}

function cssEscape(value: string): string {
  return value.replace(/"/g, '\\"');
}

export function statusRegion(name: string, className = 'status'): HTMLElement {
  return el('div', {
    role: 'status',
    'aria-label': name,
    'data-region': name,
    class: className,
  }, [messageFor(name)]);
}

/** A status region whose text is data rather than a message. */
export function valueRegion(name: string, value: string, className = 'status'): HTMLElement {
  messages.set(name, value);
  return el('div', {
    role: 'status',
    'aria-label': name,
    'data-region': name,
    class: className,
  }, [value]);
}
