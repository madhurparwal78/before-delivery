// Reusable UI pieces: status marks, dialogs, problems summary, sticky bars,
// swatch dots and rolling digits.
import { MESSAGES, failOf, type ApiFail } from './api.js';

export function el(tag: string, attrs: Record<string, unknown> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const node = document.createElement(tag) as HTMLElement;
  if (tag === 'svg' as string) {
    return makeSvgRoot(attrs, children);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k === 'dataset') Object.assign(node.dataset, v as Record<string, string>);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'value') (node as HTMLInputElement).value = String(v);
    else if (k === 'checked') (node as HTMLInputElement).checked = true;
    else if (k === 'selected') (node as HTMLOptionElement).selected = true;
    else if (k === 'disabled' || k === 'open' || k === 'hidden' || k === 'autofocus') node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function buttonEl(attrs: Record<string, unknown> = {}, ...children: (Node | string | null | undefined)[]): HTMLButtonElement {
  return el('button', attrs, ...children) as HTMLButtonElement;
}

export function makeSvgRoot(attrs: Record<string, unknown>, children: (Node | string | null | undefined)[]): HTMLElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as HTMLElement;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') svg.setAttribute('class', String(v));
    else if (k === 'html') svg.innerHTML = String(v);
    else svg.setAttribute(k, String(v));
  }
  for (const c of children) if (c != null) svg.append(c as Node);
  return svg;
}

function frag(...children: (Node | string | null | undefined)[]): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const c of children) { if (c === null || c === undefined) continue; f.append(typeof c === 'string' ? document.createTextNode(c) : c); }
  return f;
}

// Every status mark is a distinct shape beside its word.
const MARK_SVG: Record<string, string> = {
  upcoming: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/></svg>',
  live: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="2.6"/></svg>',
  sold_out: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><line x1="3" y1="13" x2="13" y2="3"/></svg>',
  withdrawn: '<svg viewBox="0 0 16 16" aria-hidden="true"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>'
};

const MARK_WORD: Record<string, string> = { upcoming: 'Upcoming', live: 'Live', sold_out: 'Sold out', withdrawn: 'Withdrawn' };
const MARK_CLASS: Record<string, string> = { upcoming: 'mark-ring', live: 'mark-dot', sold_out: 'mark-slash', withdrawn: 'mark-cross' };

export function statusMark(status: string, extraClass = ''): HTMLElement {
  return el('span', { class: `mark ${MARK_CLASS[status] ?? ''} ${extraClass}`, html: MARK_SVG[status] ?? '', 'aria-label': MARK_WORD[status] ?? status }, MARK_WORD[status] ?? status);
}

export function nightMark(): HTMLElement {
  return el('span', { class: 'night-mark fade-in' }, el('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', html: '<path d="M12.4 10.6a5.4 5.4 0 0 1-6.9-6.9 5.4 5.4 0 1 0 6.9 6.9z"/>' }), 'Night');
}

// Dialog: opening moves focus to its first field or button, Escape/Cancel closes
// and returns focus to the opener, and a refusal keeps it open with focus on its
// error text.
export interface DialogHandle {
  root: HTMLDialogElement;
  close(): void;
  onResult(promise: Promise<unknown>, onDone: (ok: boolean, fail: ApiFail | null) => void): void;
}

export function openDialog(opts: {
  label: string;
  body: (dlg: DialogHandle) => Node;
  opener: HTMLElement | null;
  sticky?: boolean;
  onSubmitted?: () => void;
  successFocus?: HTMLElement | (() => HTMLElement | null);
  stickyBarButtons?: HTMLElement[];
}): DialogHandle {
  const root = el('dialog', { 'aria-label': opts.label, class: opts.sticky ? 'sheet-dialog' : '' }) as HTMLDialogElement;
  const bodyWrap = el('div', { class: opts.sticky ? 'sheet-body' : 'dialog-body' });
  const errorBox = el('p', { class: 'dialog-error', role: 'alert', hidden: true });
  let openerFocus: HTMLElement | null = opts.opener ?? null;
  const handle: DialogHandle = {
    root,
    close(): void {
      root.close();
      document.body.classList.remove('dialog-open');
      const target = openerFocus;
      if (target && document.contains(target)) target.focus();
    },
    onResult(promise: Promise<unknown>, onDone: (ok: boolean, fail: ApiFail | null) => void): void {
      void promise.then(() => {
        root.close();
        document.body.classList.remove('dialog-open');
        const target = typeof opts.successFocus === 'function' ? opts.successFocus() : opts.successFocus;
        if (target && document.contains(target)) { target.setAttribute('tabindex', '-1'); target.focus(); }
        else openerFocus?.focus();
        opts.onSubmitted?.();
        onDone(true, null);
      }).catch(err => {
        const fail = failOf(err);
        if (fail.status === 401) {
          root.close();
          document.body.classList.remove('dialog-open');
          document.dispatchEvent(new CustomEvent('hourline:auth', { detail: fail }));
        } else {
          errorBox.hidden = false;
          errorBox.textContent = fail.fields ? problemsLine(fail) : fail.message;
          root.append(errorBox);
          errorBox.focus?.();
          root.querySelector<HTMLElement>('.dialog-error')?.focus();
          if (!root.contains(errorBox)) root.querySelector('.dialog-body')?.prepend(errorBox);
        }
        onDone(false, fail);
      });
    }
  };
  root.append(bodyWrap);
  bodyWrap.append(opts.body(handle));
  root.prepend(errorBox);
  document.body.append(root);
  root.showModal();
  document.body.classList.add('dialog-open');
  root.addEventListener('close', () => { root.remove(); document.body.classList.remove('dialog-open'); });
  root.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { openerFocus?.focus(); }
  });
  const first = root.querySelector<HTMLElement>('input, select, textarea, button');
  first?.focus();
  return handle;
}

function problemsLine(fail: ApiFail): string {
  const fields = Object.values(fail.fields ?? {});
  if (fields.length === 0) return fail.message;
  if (fields.length === 1) return fields[0];
  return `There are ${fields.length} problems. Fix them and try again.`;
}

// The Problems region for forms outside dialogs.
export function showProblems(form: HTMLElement, fail: ApiFail, fieldLabels: Record<string, string>): HTMLElement {
  let region = form.querySelector<HTMLElement>('[role="region"].problems');
  if (!region) {
    region = el('div', { class: 'problems', role: 'region', 'aria-label': 'Problems', tabindex: '-1' });
    form.prepend(region);
  }
  region.textContent = '';
  const n = Object.keys(fail.fields ?? {}).length;
  region.append(el('h2', {}, 'Problems'));
  for (const [path, message] of Object.entries(fail.fields ?? {})) {
    const label = fieldLabels[path] ?? path;
    const link = el('a', { href: '#', text: `${label}: ${message}`, onclick: (e: Event) => {
      e.preventDefault();
      const field = fieldByName(form, path);
      if (field) { field.focus(); field.scrollIntoView({ block: 'center', behavior: 'instant' }); }
    } });
    region.append(link);
  }
  if (n > 0 && Object.keys(fail.fields ?? {}).length === 0) {
    region.append(el('p', { text: fail.message }));
  }
  region.focus();
  return region;
}

export function fieldByName(form: HTMLElement, path: string): HTMLElement | null {
  return form.querySelector<HTMLElement>(`[name="${cssEscape(path)}"]`);
}

function cssEscape(s: string): string {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

export function fieldError(form: HTMLElement, path: string, message: string, label: string): void {
  const field = fieldByName(form, path);
  if (!field) return;
  let wrap = field.closest('.field') as HTMLElement | null;
  if (!wrap) wrap = field.parentElement;
  let err = wrap?.querySelector<HTMLElement>('.err');
  if (!err && wrap) {
    err = el('span', { class: 'err' });
    wrap.append(err);
  }
  if (err) { err.textContent = message; err.id = `${cssEscape(path)}-err`; }
  field.setAttribute('aria-invalid', 'true');
  void label;
}

export function clearFieldErrors(form: HTMLElement): void {
  form.querySelectorAll<HTMLElement>('.err').forEach(e => { e.textContent = ''; });
  form.querySelectorAll<HTMLElement>('[aria-invalid]').forEach(e => e.removeAttribute('aria-invalid'));
  form.querySelectorAll('.problems').forEach(p => p.remove());
}

// Pending buttons keep in place, show pending copy and ignore further presses.
export function pending(btn: HTMLButtonElement, copy: string): () => void {
  const original = btn.textContent ?? '';
  btn.textContent = copy;
  btn.disabled = true;
  return () => { btn.textContent = original; btn.disabled = false; };
}

// Swatch dots scatter from the pointer on mouse events only: the app decides by
// the kind of pointer each event comes from.
export function swatchDots(container: HTMLElement, palette: string[]): void {
  container.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const rect = container.getBoundingClientRect();
    for (let i = 0; i < 3; i++) {
      const dot = el('span', { class: 'swatch-dot', style: `background: ${palette[i % palette.length]}; --dx: ${(Math.random() - 0.5) * 90}px; --dy: ${(Math.random() - 0.5) * 90 - 30}px;` });
      dot.style.left = `${e.clientX - rect.left}px`;
      dot.style.top = `${e.clientY - rect.top}px`;
      dot.style.position = 'absolute';
      container.append(dot);
      setTimeout(() => dot.remove(), 200);
    }
  });
}

// A live region that announces results politely.
export function liveRegion(label: string): HTMLElement {
  return el('p', { role: 'status', 'aria-label': label, class: 'status-line' });
}

export function announce(target: HTMLElement, text: string, isError = false): void {
  target.className = `status-line ${isError ? 'status-err' : 'status-ok'}`;
  target.textContent = '';
  requestAnimationFrame(() => { target.textContent = text; });
}

export function validationAnnounce(fail: ApiFail): string {
  const n = Object.keys(fail.fields ?? {}).length;
  return n <= 1 ? 'There is 1 problem. Fix it and try again.' : `There are ${n} problems. Fix them and try again.`;
}

export function emptyRow(colspan: number): HTMLTableRowElement {
  return el('tr', { class: 'empty-row' }, el('td', { colspan }, 'Nothing here yet.')) as unknown as HTMLTableRowElement;
}
