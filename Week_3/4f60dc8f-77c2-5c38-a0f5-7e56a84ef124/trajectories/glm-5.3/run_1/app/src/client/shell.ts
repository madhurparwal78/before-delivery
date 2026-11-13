/** Shared client utilities: fetch helpers, live regions, dialogs, outage banner. */

export interface ApiErrorShape {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export async function api<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: T | ApiErrorShape }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = { error: 'not_found', message: 'We couldn\'t find that page' };
  }
  return { status: response.status, json: json as T | ApiErrorShape };
}

export function isApiError(json: unknown): json is ApiErrorShape {
  return typeof json === 'object' && json !== null && 'error' in json && 'message' in json;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
}

export function setStatus(region: HTMLElement, text: string): void {
  if (region.textContent !== text) {
    region.textContent = text;
  }
}

export function formatMoneyMinor(minor: number, symbol: string, exponent: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  let whole = abs;
  let fraction = '';
  if (exponent > 0) {
    const divisor = 10 ** exponent;
    whole = Math.trunc(abs / divisor);
    const frac = abs % divisor;
    fraction = '.' + String(frac).padStart(exponent, '0');
  }
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${symbol}${grouped}${fraction}`;
}

export const CURRENCY_SYMBOLS: Record<string, string> = { GBP: '£', EUR: '€', USD: '$', JPY: '¥' };
export const CURRENCY_EXPONENTS: Record<string, number> = { GBP: 2, EUR: 2, USD: 2, JPY: 0 };

export function formatUtcDate(iso: string): string {
  const date = new Date(iso);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatUtcTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export const MILESTONE_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  look_dev: 'Look-dev',
  final_delivery: 'Final delivery',
};

/** Outage banner + 10-second status refresh. Never touches dialogs or focus. */
interface OutageCopy {
  billing: string;
  storage: string;
  email: string;
  measuring: string;
  documents: string;
}

export const OUTAGE_COPY: OutageCopy = {
  billing: 'Billing is offline right now. Nothing has been charged. Please try again in a few minutes.',
  storage: 'File storage is offline right now. Your file was not saved. Please try again in a few minutes.',
  email: 'Email is offline right now. Nothing has been charged. Please try again in a few minutes.',
  measuring: 'Measuring is delayed. Your files are stored safely and will be measured when the queue is back.',
  documents: 'Documents are offline right now. Payments still go through, and receipts and invoices will be emailed once documents are back.',
};

export function mountOutageBanner(): { banner: HTMLElement; refresh: () => Promise<void> } {
  const banner = el('div', 'outage-banner');
  banner.setAttribute('role', 'alert');
  banner.hidden = true;
  document.querySelector('.main-nav')?.insertAdjacentElement('afterend', banner);

  const render = (statuses: Record<string, string>): void => {
    const lines: string[] = [];
    if (statuses.billing === 'down') lines.push(OUTAGE_COPY.billing);
    if (statuses.storage === 'down') lines.push(OUTAGE_COPY.storage);
    if (statuses.email === 'down') lines.push(OUTAGE_COPY.email);
    if (statuses.measuring === 'down') lines.push(OUTAGE_COPY.measuring);
    if (statuses.documents === 'down') lines.push(OUTAGE_COPY.documents);
    const openDialog = document.querySelector('dialog[open]') !== null;
    if (lines.length > 0 && !openDialog) {
      banner.hidden = false;
      banner.innerHTML = lines.map(line => `<p>${escapeHtml(line)}</p>`).join('');
    } else if (!openDialog) {
      banner.hidden = true;
    }
  };

  const refresh = async (): Promise<void> => {
    const { status, json } = await api<Record<string, string>>('GET', '/api/status');
    if (status === 200 && !isApiError(json)) {
      render(json);
    }
  };
  void refresh();
  setInterval(refresh, 10_000);
  return { banner, refresh };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Error summary for forms with field errors. */
export function mountErrorSummary(form: HTMLElement): { show: (fields: Record<string, string>, summaryText?: string) => void; hide: () => void } {
  let summary = form.querySelector('.error-summary') as HTMLElement | null;
  if (!summary) {
    summary = el('div', 'error-summary');
    summary.setAttribute('role', 'alert');
    summary.hidden = true;
    const heading = el('h2');
    heading.textContent = 'There is a problem';
    summary.appendChild(heading);
    const list = el('ul');
    summary.appendChild(list);
    form.prepend(summary);
  }
  const list = summary.querySelector('ul') as HTMLUListElement;
  const show = (fields: Record<string, string>): void => {
    list.innerHTML = '';
    for (const [field, message] of Object.entries(fields)) {
      const item = el('li');
      const link = el('a');
      link.href = `#${field}`;
      link.textContent = message;
      link.addEventListener('click', event => {
        event.preventDefault();
        const target = form.querySelector(`[data-field="${field}"]`) ?? form.querySelector(`#${field}`);
        (target as HTMLElement | null)?.focus();
      });
      item.appendChild(link);
      summary?.setAttribute('data-error-for', field);
      item.appendChild(link);
      list.appendChild(item);
    }
    // Mark fields invalid
    form.querySelectorAll<HTMLElement>('.field').forEach(fieldEl => {
      fieldEl.removeAttribute('data-invalid');
    });
    for (const field of Object.keys(fields)) {
      const fieldEl = form.querySelector(`.field[data-for="${field}"]`);
      fieldEl?.setAttribute('data-invalid', 'true');
    }
    summary.hidden = false;
    summary.focus?.();
    summary.setAttribute('tabindex', '-1');
    (summary as HTMLElement).focus();
  };
  const hide = (): void => {
    summary.hidden = true;
    form.querySelectorAll<HTMLElement>('.field').forEach(fieldEl => fieldEl.removeAttribute('data-invalid'));
  };
  return { show, hide };
}

/** Focus trap for a dialog: Tab wraps, Escape closes, focus returns to opener. */
export function trapDialog(dialog: HTMLDialogElement, onClose: () => void): void {
  const opener = document.activeElement as HTMLElement | null;
  dialog.showModal();
  const first = focusable(dialog)[0];
  if (first) {
    first.focus();
  }
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const items = focusable(dialog);
      if (items.length === 0) {
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }
  };
  const close = (): void => {
    dialog.close();
    cleanup();
    onClose();
    opener?.focus();
  };
  const cleanup = (): void => {
    dialog.removeEventListener('keydown', keydown);
  };
  dialog.addEventListener('keydown', keydown);
  dialog.dataset.close = 'true';
}

function focusable(root: HTMLElement): HTMLElement[] {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(item => item.offsetParent !== null || item === document.activeElement);
}

/** Wire the phone navigation drawer. */
export function mountNavDrawer(): void {
  const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
  const links = document.querySelector<HTMLElement>('.nav-links');
  if (!toggle || !links) {
    return;
  }
  const setOpen = (open: boolean): void => {
    toggle.setAttribute('aria-expanded', String(open));
    links.dataset.open = String(open);
    for (const link of Array.from(links.querySelectorAll('a'))) {
      if (open) {
        link.removeAttribute('inert');
      } else {
        link.setAttribute('inert', '');
      }
    }
    if (open) {
      links.querySelector('a')?.focus();
    } else {
      toggle.focus();
    }
  };
  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  links.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      const items = Array.from(links.querySelectorAll('a'));
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
  // Close when a link is followed.
  links.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('a')) {
      setOpen(false);
    }
  });
  // Start closed: links unfocusable.
  for (const link of Array.from(links.querySelectorAll('a'))) {
    link.setAttribute('inert', '');
  }
}

/** The shared shell: navigation, drawer, current-page highlighting. */
export function mountShell(): void {
  mountNavDrawer();
  const path = window.location.pathname;
  const links = document.querySelectorAll<HTMLElement>('.nav-links a');
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    const target = href.split('#')[0];
    if (target !== '' && target !== '/' && path.startsWith(target)) {
      link.setAttribute('aria-current', 'page');
    } else if (href.startsWith('/#') && path === '/') {
      link.setAttribute('aria-current', 'page');
    }
  }
}
