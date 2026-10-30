// DOM helpers, live regions, dialogs, focus management, formatting.

export interface InteractiveElement extends HTMLElement {
  disabled?: boolean;
}

export function h(
  tag: string,
  attrs: Record<string, unknown> | null = null,
  ...children: (Node | string | null | undefined | (Node | string | null)[])[]
): InteractiveElement {
  const element = document.createElement(tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (name === 'class') {
        element.className = String(value);
      } else if (name === 'text') {
        element.textContent = String(value);
      } else if (name.startsWith('on') && typeof value === 'function') {
        element.addEventListener(name.slice(2), value as EventListener);
      } else if (value === true) {
        element.setAttribute(name, '');
      } else {
        element.setAttribute(name, String(value));
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (Array.isArray(child)) {
      for (const nested of child) {
        if (nested === null || nested === undefined) continue;
        element.append(typeof nested === 'string' ? document.createTextNode(nested) : nested);
      }
    } else {
      element.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return element;
}

export function clear(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

let announcements: HTMLElement | null = null;
let problems: HTMLElement | null = null;

export function initLiveRegions(): void {
  announcements = document.getElementById('live-status');
  problems = document.getElementById('live-alert');
}

export function announce(message: string): void {
  if (!announcements) return;
  announcements.textContent = '';
  requestAnimationFrame(() => {
    announcements!.textContent = message;
  });
}

export function reportProblem(message: string): void {
  if (!problems) return;
  problems.textContent = '';
  requestAnimationFrame(() => {
    problems!.textContent = message;
  });
}

// ---------- Formatting (mirrors the server's published formats) ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function instantText(iso: string, zone: 'HK' | 'SG' | 'MO' = 'HK'): string {
  const date = new Date(iso);
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const day = shifted.getUTCDate();
  const hours = shifted.getUTCHours().toString().padStart(2, '0');
  const minutes = shifted.getUTCMinutes().toString().padStart(2, '0');
  const seconds = shifted.getUTCSeconds().toString().padStart(2, '0');
  return `${day} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}, ${hours}:${minutes}:${seconds} ${zone === 'SG' ? 'SGT' : 'HKT'}`;
}

export function dateText(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map((part) => parseInt(part, 10));
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function amountText(currency: string, cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const frac = absolute % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${currency} ${grouped}.${frac.toString().padStart(2, '0')}`;
}

export function hkToday(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---------- Dialogs ----------

export interface DialogHandle {
  close: () => void;
  element: HTMLElement;
}

export function openDialog(
  title: string,
  buildBody: (container: HTMLElement, close: () => void) => HTMLElement | void,
  options: { returnFocusTo?: HTMLElement; labelledBy?: string } = {},
): DialogHandle {
  const previousFocus = options.returnFocusTo ?? (document.activeElement as HTMLElement | null);
  const overlay = h('div', { class: 'dialog-backdrop', 'data-dialog': 'true' });
  const panel = h('div', { class: 'dialog-panel', role: 'dialog', 'aria-modal': 'true' });
  if (options.labelledBy) panel.setAttribute('aria-labelledby', options.labelledBy);
  const heading = h('h2', { class: 'dialog-title', id: options.labelledBy ?? null, text: title });
  const body = h('div', { class: 'dialog-body' });
  const close = () => {
    overlay.remove();
    document.body.classList.remove('has-open-dialog');
    if (previousFocus) {
      previousFocus.focus();
    }
  };
  const built = buildBody(body, close);
  panel.append(heading, built ?? body);
  const cancelButton = h('button', { class: 'button-secondary', type: 'button', text: 'Cancel', onclick: close });
  const actions = h('div', { class: 'dialog-actions' }, cancelButton);
  panel.append(actions);
  overlay.append(panel);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  document.body.classList.add('has-open-dialog');
  // Focus trap: focus first field.
  const focusables = panel.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex]');
  const first = focusables[0] ?? heading;
  (first as HTMLElement).focus();
  heading.tabIndex = -1;
  const trap = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      document.removeEventListener('keydown', trap, true);
      return;
    }
    if (event.key === 'Tab') {
      const focusableList = Array.from(panel.querySelectorAll<HTMLElement>('input:not([type=hidden]), select, textarea, button, a, [tabindex]:not([tabindex="-1"])')).filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (focusableList.length === 0) return;
      const firstEl = focusableList[0];
      const lastEl = focusableList[focusableList.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }
  };
  document.addEventListener('keydown', trap, true);
  overlay.addEventListener('plumbline:dialog-closed', () => {
    document.removeEventListener('keydown', trap, true);
  });
  return { close, element: panel };
}

// ---------- Field errors ----------

export interface FieldErrorSummary {
  [field: string]: string;
}

export function fieldId(field: string): string {
  return `field-${field.replace(/[^a-zA-Z0-9]/g, '-')}`;
}

export function labelFor(field: string): string {
  const LABELS: Record<string, string> = {
    email: 'Email',
    password: 'Password',
    name: 'Name',
    phone: 'Phone',
    role: 'Role',
    brandId: 'Brand',
    companyName: 'Company name',
    'approvalLimits.HKD': 'Approval limit HKD',
    'approvalLimits.SGD': 'Approval limit SGD',
    title: 'Title',
    description: 'Description',
    amountCents: 'Amount',
    storeCode: 'Store',
    reason: 'Reason',
    message: 'Message to approvers',
    internalNote: 'Internal note',
    scope: 'Scope',
    closesAtLocal: 'Close date and time',
    contingencyPercent: 'Contingency percent',
    periodEnding: 'Period ending',
    grossValuationCents: 'Gross valuation to date',
    date: 'Practical completion date',
    observedOn: 'Observed on',
    s: 'Across',
    y: 'Height',
    code: 'Finish code',
    finishName: 'Finish name',
    category: 'Category',
    company: 'Company',
    sites: 'Number of sites',
    openingMonth: 'Target opening month',
    sector: 'Sector',
    region: 'Region',
    file: 'File',
    sheetRevisions: 'Sheet revisions',
    purpose: 'Purpose',
    reference: 'Reference',
    comments: 'Comments',
    code_review: 'Review code',
  };
  return LABELS[field] ?? field;
}

export function showFieldErrors(form: HTMLElement, errors: FieldErrorSummary): HTMLElement | null {
  form.querySelectorAll('[data-error-for]').forEach((el) => el.remove());
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const summary = form.querySelector('[data-error-summary]');
  if (summary) {
    clear(summary as HTMLElement);
    const list = h('ul', { class: 'error-summary-list' });
    for (const [field, message] of Object.entries(errors)) {
      const target = form.querySelector<HTMLElement>(`#${fieldId(field)}`);
      const link = h(
        'a',
        {
          href: '#',
          onclick: (event: Event) => {
            event.preventDefault();
            if (target) {
              target.focus();
            }
          },
        },
        message,
      );
      list.append(h('li', {}, link));
      const errorElement = h('p', { class: 'field-error', 'data-error-for': field, id: `${fieldId(field)}-error`, text: message });
      const container = target?.closest('.field') ?? form;
      container.append(errorElement);
      if (target) {
        target.setAttribute('aria-invalid', 'true');
        target.setAttribute('aria-describedby', `${fieldId(field)}-error`);
      }
    }
    summary.append(list);
    const firstLink = list.querySelector('a');
    if (firstLink) firstLink.focus();
    return firstLink;
  }
  return null;
}

// ---------- Reduced motion ----------

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function setFocusTarget(element: InteractiveElement | null): void {
  if (element) {
    element.setAttribute('tabindex', '-1');
    element.focus({ preventScroll: false });
    element.addEventListener('blur', () => element.removeAttribute('tabindex'), { once: true });
  }
}

const ICON_PATHS: Record<string, string> = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  'arrow-left': '<path d="M19 12H5m7-7-7 7 7 7"/>',
  'arrow-right': '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 15V4m-5 5 5-5 5 5"/><path d="M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"/>',
  download: '<path d="M12 4v11m-5-5 5 5 5-5"/><path d="M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/>',
  pencil: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/>',
};

export function icon(name: string, shape?: string): HTMLElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICON_PATHS[name] ?? '';
  const span = h('span', { class: 'icon-wrap' });
  if (shape) span.setAttribute('data-shape', shape);
  span.append(svg);
  return span;
}
