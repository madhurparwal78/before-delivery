// Small DOM, formatting and dialog helpers shared by every screen.

export type Attrs = Record<string, string | number | boolean | null | undefined>;
export type Child = Node | string | null | undefined | Child[];

/** el builds an element with attributes, dataset entries and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('data-')) node.setAttribute(key, String(value));
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (typeof child === 'string') parent.appendChild(document.createTextNode(child));
    else parent.appendChild(child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** on wires a listener and hands back its remover. */
export function on<E extends keyof HTMLElementEventMap>(
  node: HTMLElement | Document | Window,
  event: E | string,
  handler: (ev: any) => void,
  options?: AddEventListenerOptions,
): () => void {
  node.addEventListener(event as string, handler, options);
  return () => node.removeEventListener(event as string, handler, options);
}

// ---------- Fuse Clock and time formatting ----------

/** formatRemaining renders a server's remaining milliseconds as the Fuse Clock
 *  numerals print it. */
export function formatRemaining(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 60_000) {
    const tenths = Math.floor(clamped / 100) / 10;
    return tenths.toFixed(1);
  }
  const totalSeconds = Math.floor(clamped / 1000);
  if (clamped < 3_600_000) {
    const minutes = Math.floor(totalSeconds / 60);
    return `${minutes}:${pad(totalSeconds % 60)}`;
  }
  if (clamped < 86_400_000) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}:${pad(minutes)}:${pad(totalSeconds % 60)}`;
  }
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${pad(hours)}:${pad(minutes)}`;
}

/** formatCountUp renders the counting-up Lap timer as m:ss.d. */
export function formatCountUp(ms: number): string {
  const clamped = Math.max(0, ms);
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const tenths = Math.floor((clamped % 1000) / 100);
  return `${minutes}:${pad(seconds)}.${tenths}`;
}

/** formatLap renders a stored lap time as m:ss.mmm. */
export function formatLap(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}:${pad(seconds)}.${String(ms % 1000).padStart(3, '0')}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

type Fields = Record<string, string>;

/** zoneParts breaks an instant into the pieces the screens print. */
export function zoneParts(instant: string, zone: string): Fields {
  const date = new Date(instant);
  const parts: Fields = {};
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  } catch {
    return { weekday: '', day: '', month: '', year: '', hour: '', minute: '' };
  }
  if (parts.hour === '24') parts.hour = '00';
  parts.timeZoneName = zoneAbbr(instant, zone);
  return parts;
}

/** dayMonth renders `Ddd D Mon`. */
export function dayMonth(instant: string, zone: string): string {
  const p = zoneParts(instant, zone);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** dayMonthYear renders `Ddd D Mon YYYY`. */
export function dayMonthYear(instant: string, zone: string): string {
  const p = zoneParts(instant, zone);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** clockTime renders `HH:MM`. */
export function clockTime(instant: string, zone: string): string {
  const p = zoneParts(instant, zone);
  return `${p.hour}:${p.minute}`;
}

/** zoneAbbr renders the IANA zone abbreviation in force at an instant, such as
 *  CST, CET or +03.
 *
 *  No single locale names every zone: en-US gives CST for Chicago but GMT+1 for
 *  Berlin, and en-GB the other way round. So each is tried in turn, and a zone
 *  neither of them abbreviates falls back to its offset. */
export function zoneAbbr(instant: string, zone: string): string {
  const date = new Date(instant);
  for (const locale of ['en-US', 'en-GB']) {
    let named = '';
    try {
      const formatter = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' });
      named = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? '';
    } catch {
      return '';
    }
    if (named && !/^(GMT|UTC)[+-]?/.test(named)) return named;
  }
  return offsetAbbr(date, zone);
}

/** offsetAbbr renders a zone with no abbreviation of its own as +03 or +05:30. */
function offsetAbbr(date: Date, zone: string): string {
  let longOffset = '';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    longOffset = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(longOffset);
  if (!match) return 'UTC';
  const [, sign, hours, minutes] = match;
  return minutes === '00' ? `${sign}${hours}` : `${sign}${hours}:${minutes}`;
}

/** stampDayTime renders `Ddd D Mon HH:MM abbr`, as the history tables print. */
export function stampDayTime(instant: string, zone: string): string {
  return `${dayMonth(instant, zone)} ${clockTime(instant, zone)} ${zoneAbbr(instant, zone)}`;
}

/** viewerZone reports the browser's IANA zone. */
export function viewerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** zoneNames lists the IANA zones the time-zone combobox offers. */
export function zoneNames(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  const names = supported ? supported('timeZone') : [];
  const own = viewerZone();
  if (names.length === 0) return [own, 'UTC'];
  return names.includes(own) ? names : [own, ...names];
}

// ---------- Dialogs ----------

/** OpenDialog is one entry of the dialog stack. */
export interface OpenDialog {
  root: HTMLElement;
  opener: HTMLElement | null;
  close: () => void;
  scrim?: HTMLElement;
}

const stack: OpenDialog[] = [];

/** focusables lists the controls a dialog traps focus between. */
export function focusables(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
    ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

/** openDialog pushes a dialog, traps Tab inside it and closes it on Escape. */
export function openDialog(entry: OpenDialog, options: { escapeCloses?: boolean } = {}): void {
  const escapeCloses = options.escapeCloses !== false;
  stack.push(entry);

  const keydown = (ev: KeyboardEvent) => {
    if (stack[stack.length - 1] !== entry) return;
    if (ev.key === 'Escape' && escapeCloses) {
      ev.preventDefault();
      ev.stopPropagation();
      entry.close();
      return;
    }
    if (ev.key !== 'Tab') return;
    const items = focusables(entry.root);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (ev.shiftKey && (active === first || !entry.root.contains(active))) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && (active === last || !entry.root.contains(active))) {
      ev.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', keydown, true);
  (entry as OpenDialog & { detach?: () => void }).detach = () =>
    document.removeEventListener('keydown', keydown, true);
}

/** closeDialog pops a dialog and hands focus back to whatever opened it. */
export function closeDialog(entry: OpenDialog): void {
  const at = stack.indexOf(entry);
  if (at === -1) return;
  stack.splice(at, 1);
  (entry as OpenDialog & { detach?: () => void }).detach?.();
  entry.root.remove();
  entry.scrim?.remove();
  entry.opener?.focus();
}

/** topDialog reports the dialog currently on top, if any. */
export function topDialog(): OpenDialog | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** dialogDepth reports how many dialogs are open. */
export function dialogDepth(): number {
  return stack.length;
}

/** scrim builds the panel blur scrim, which blocks pointer input beneath it and
 *  is never exposed to the accessibility tree. */
export function scrim(): HTMLElement {
  return el('div', { class: 'scrim', 'aria-hidden': 'true' });
}

/** firstFocus moves focus to a dialog's preferred control. */
export function firstFocus(root: HTMLElement, preferred?: HTMLElement | null): void {
  const target = preferred ?? focusables(root)[0];
  target?.focus();
}
