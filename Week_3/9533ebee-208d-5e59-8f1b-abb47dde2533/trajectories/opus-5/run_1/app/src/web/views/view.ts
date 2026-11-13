/** What every view offers the shell. */

export interface View {
  readonly element: HTMLElement;
  /** Called on every 5-second refresh and after every action of its own. */
  update(): void;
  /** Called when the view is replaced, so it can drop its own timers. */
  navigateAway(): void;
  /** Called after any successful price post, so rulers recentre. */
  onPost(): void;
  readonly navigate: (path: string) => void;
}

/** A fresh Idempotency-Key for one money movement. */
export function freshKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
