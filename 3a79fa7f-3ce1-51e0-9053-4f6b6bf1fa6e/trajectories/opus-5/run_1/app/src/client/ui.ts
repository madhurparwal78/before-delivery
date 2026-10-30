import { append, clear, el, formatCents, svgIcon, uniqueId, type Child } from './dom.js';
import type { FinancingTerm } from './types.js';

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let statusRegion: HTMLElement | null = null;

export function setStatusRegion(node: HTMLElement): void {
  statusRegion = node;
}

export function announce(message: string): void {
  if (!statusRegion) return;
  statusRegion.textContent = '';
  window.setTimeout(() => {
    if (statusRegion) statusRegion.textContent = message;
  }, 30);
}

/** "As low as $<m>/mo" from the server's financing for this surface's amount. */
export function financingLine(terms: FinancingTerm[]): HTMLElement | null {
  if (terms.length === 0) return null;
  const monthly = Math.min(...terms.map((term) => term.monthly_cents));
  return el('p', { class: 'financing-line', 'data-monthly-cents': monthly }, `As low as ${formatCents(monthly)}/mo`);
}

export interface FieldOptions {
  type?: string;
  inputmode?: string;
  value?: string;
  helper?: string;
  options?: { value: string; label: string }[];
  min?: string;
  max?: string;
  step?: string;
  autocomplete?: string;
  required?: boolean;
  rows?: number;
}

export interface FieldHandle {
  wrapper: HTMLElement;
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  setError(message: string | null): void;
}

export function field(label: string, kind: 'text' | 'select' | 'textarea', options: FieldOptions = {}): FieldHandle {
  const id = uniqueId('field');
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const labelNode = el('label', { for: id }, label);
  let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

  if (kind === 'select') {
    const select = el('select', { id, name: id });
    for (const option of options.options ?? []) {
      select.appendChild(el('option', { value: option.value }, option.label));
    }
    if (options.value !== undefined) select.value = options.value;
    control = select;
  } else if (kind === 'textarea') {
    control = el('textarea', { id, name: id, rows: options.rows ?? 4 }, options.value ?? '');
  } else {
    control = el('input', {
      id,
      name: id,
      type: options.type ?? 'text',
      value: options.value ?? '',
      min: options.min,
      max: options.max,
      step: options.step,
      autocomplete: options.autocomplete,
      inputmode: options.inputmode,
    });
  }

  const helper = options.helper ? el('p', { class: 'caption', id: helperId }, options.helper) : null;
  const error = el('p', { class: 'field-error', id: errorId, hidden: true });
  if (helper) control.setAttribute('aria-describedby', helperId);

  const wrapper = el('div', { class: 'field' }, [labelNode, control, helper, error]);
  return {
    wrapper,
    control,
    setError(message) {
      if (message) {
        clear(error);
        append(error, [svgIcon('warning'), el('span', {}, message)]);
        error.hidden = false;
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-errormessage', errorId);
        control.setAttribute('aria-describedby', helper ? `${helperId} ${errorId}` : errorId);
      } else {
        error.hidden = true;
        clear(error);
        control.removeAttribute('aria-invalid');
        control.removeAttribute('aria-errormessage');
        control.setAttribute('aria-describedby', helper ? helperId : '');
        if (!helper) control.removeAttribute('aria-describedby');
      }
    },
  };
}

export function applyFieldErrors(
  handles: Record<string, FieldHandle>,
  fields: Record<string, string> | undefined,
): void {
  let first: FieldHandle | null = null;
  for (const [name, handle] of Object.entries(handles)) {
    const message = fields?.[name];
    handle.setError(message ?? null);
    if (message && !first) first = handle;
  }
  if (first) first.control.focus();
}

export function button(label: string, attrs: Record<string, unknown> = {}, children?: Child): HTMLButtonElement {
  return el('button', { class: 'btn', type: 'button', ...(attrs as Record<string, string>) }, children ?? label);
}

export function link(label: string, href: string, attrs: Record<string, unknown> = {}): HTMLAnchorElement {
  return el('a', { href, ...(attrs as Record<string, string>) }, label);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogHandle {
  close(): void;
  body: HTMLElement;
}

/** Every dialog traps focus and returns it to the control that opened it. */
export function openDialog(options: {
  title: string;
  content: Child;
  variant?: 'dialog' | 'drawer';
  opener?: HTMLElement | null;
  onClose?: () => void;
  closeLabel?: string;
}): DialogHandle {
  const opener = options.opener ?? (document.activeElement as HTMLElement | null);
  const titleId = uniqueId('dialog-title');
  const drawer = options.variant === 'drawer';
  const instant = reducedMotion();

  const closeButton = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, [
    svgIcon('cross'),
    el('span', {}, options.closeLabel ?? 'Close'),
  ]);
  const body = el('div', {});
  append(body, options.content);

  const panel = el(
    'div',
    {
      class: drawer ? `drawer${instant ? '' : ' entering'}` : `dialog${instant ? '' : ' appearing'}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    },
    [el('div', { class: 'dialog-head' }, [el('h2', { id: titleId }, options.title), closeButton]), body],
  );
  const scrim = el('div', { class: drawer ? 'drawer-scrim' : 'scrim' }, panel);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    const finish = (): void => {
      scrim.remove();
      options.onClose?.();
      if (opener && document.contains(opener)) opener.focus();
    };
    if (drawer && !instant) {
      panel.classList.remove('entering');
      panel.classList.add('leaving');
      window.setTimeout(finish, 200);
    } else finish();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === panel);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!panel.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener('click', close);
  scrim.addEventListener('mousedown', (event) => {
    if (event.target === scrim) close();
  });
  document.addEventListener('keydown', onKeyDown, true);
  document.body.appendChild(scrim);

  const inBody = body.querySelector<HTMLElement>(FOCUSABLE);
  (inBody ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();

  return { close, body };
}

export function disclosure(question: string, answer: string): HTMLElement {
  const bodyId = uniqueId('disclosure');
  const icon = svgIcon('plus');
  const body = el('div', { class: 'disclosure-body', id: bodyId, hidden: true }, el('p', {}, answer));
  const trigger = el('button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': bodyId }, [
    el('span', {}, question),
    icon,
  ]);
  trigger.addEventListener('click', () => {
    const open = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
    body.hidden = open;
    icon.replaceWith(svgIcon(open ? 'plus' : 'minus'));
    if (!open && !reducedMotion()) {
      body.classList.add('unfolding');
      window.setTimeout(() => body.classList.remove('unfolding'), 320);
    }
  });
  return el('div', { class: 'disclosure' }, [trigger, body]);
}

export function sectionReveal(node: HTMLElement): void {
  if (reducedMotion()) {
    node.classList.add('at-rest');
    return;
  }
  node.classList.add('reveal');
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.2) {
          node.classList.add('revealed');
          observer.disconnect();
        }
      }
    },
    { threshold: [0.2] },
  );
  observer.observe(node);
}

/** The ride readout is the only number that counts; the gauge settles when it ends. */
export function countTo(node: HTMLElement, from: number, to: number, render: (value: number) => string, onDone: () => void): void {
  if (reducedMotion() || from === to) {
    node.textContent = render(to);
    onDone();
    return;
  }
  const start = performance.now();
  const duration = 400;
  const step = (stamp: number): void => {
    const ratio = Math.min(1, (stamp - start) / duration);
    const eased = 1 - (1 - ratio) ** 3;
    node.textContent = render(Math.round(from + (to - from) * eased));
    if (ratio < 1) requestAnimationFrame(step);
    else {
      node.textContent = render(to);
      onDone();
    }
  };
  requestAnimationFrame(step);
}

export function gauge(bars: number): HTMLElement {
  return el(
    'span',
    { class: 'gauge', role: 'img', 'aria-label': `Battery gauge, ${bars} of 4 bars` },
    [1, 2, 3, 4].map((index) => el('span', { class: index <= bars ? 'lit' : '' })),
  );
}

export function updateGauge(node: HTMLElement, bars: number): void {
  node.setAttribute('aria-label', `Battery gauge, ${bars} of 4 bars`);
  [...node.children].forEach((child, index) => {
    child.className = index < bars ? 'lit' : '';
  });
}
