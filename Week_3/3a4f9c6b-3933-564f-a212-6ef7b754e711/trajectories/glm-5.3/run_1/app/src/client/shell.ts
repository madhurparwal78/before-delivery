// Shared client state: session, live regions, dialogs and refresh loop.

import { ApiError, NetworkError, Session, api, newRequestKey } from './api.js';
import { esc } from './ui.js';

export interface Live {
  activity(text: string): void;
  problem(text: string): void;
  queue(texts: string[]): void;
}

export function makeLive(): { root: HTMLElement; live: Live } {
  const root = document.createElement('div');
  root.className = 'live';
  root.innerHTML = `
    <div class="activity" role="status" aria-live="polite" aria-label="Activity" id="activity"></div>
    <div class="problem" role="alert" aria-live="assertive" aria-label="Problem" id="problem"></div>
    <div class="queue" role="status" aria-live="polite" aria-label="Delivery queue" id="queue"></div>
  `;
  const activity = root.querySelector<HTMLElement>('#activity')!;
  const problem = root.querySelector<HTMLElement>('#problem')!;
  const queue = root.querySelector<HTMLElement>('#queue')!;
  const live: Live = {
    activity(text) { activity.textContent = text; },
    problem(text) { problem.textContent = text; },
    queue(texts) { queue.textContent = texts.join(' '); },
  };
  return { root, live };
}

// ------------------------------------------------------------ dialogs

export interface FieldSpec {
  name: string;
  label: string;
  type?: 'text' | 'textarea';
  value?: string;
  placeholder?: string;
  readOnly?: boolean;
}

export interface DialogSpec {
  title: string;
  body?: string;
  /** Optional pre-built node rendered inside the dialog above the fields. */
  bodyNode?: HTMLElement;
  fields?: FieldSpec[];
  checkboxes?: { name: string; label: string; checked?: boolean }[];
  select?: { name: string; label: string; options: { value: string; label: string }[] };
  confirmLabel: string;
  confirmClass?: string;
  showSummary?: { label: string; rows: string[] };
  onSubmit: (values: Record<string, string>) => Promise<void>;
}

export class DialogHost {
  private overlay: HTMLElement | null = null;
  private lastFocus: HTMLElement | null = null;
  private pendingConfirm = false;

  constructor(private readonly live: Live, private readonly onSessionEnded: () => void) {}

  open(spec: DialogSpec): void {
    this.close();
    this.lastFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(spec.title)}">
        <h2>${esc(spec.title)}</h2>
        ${spec.body ? `<p class="note">${esc(spec.body)}</p>` : ''}
        ${spec.showSummary ? `<section><h4>${esc(spec.showSummary.label)}</h4><div class="kv">${spec.showSummary.rows.map((r) => `<div class="history-row"><span>${esc(r)}</span></div>`).join('')}</div></section>` : ''}
        <div data-custom-body></div>
        <form novalidate>
          ${spec.select ? `
            <div class="field" data-field="${esc(spec.select.name)}">
              <label for="f-${esc(spec.select.name)}">${esc(spec.select.label)}</label>
              <select id="f-${esc(spec.select.name)}" name="${esc(spec.select.name)}">
                ${spec.select.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
              </select>
              <p class="error" hidden></p>
            </div>` : ''}
          ${(spec.fields ?? []).map((f) => `
            <div class="field" data-field="${esc(f.name)}">
              <label for="f-${esc(f.name)}">${esc(f.label)}</label>
              ${f.type === 'textarea'
                ? `<textarea id="f-${esc(f.name)}" name="${esc(f.name)}" rows="3" ${f.readOnly ? 'readonly' : ''}>${esc(f.value ?? '')}</textarea>`
                : `<input id="f-${esc(f.name)}" name="${esc(f.name)}" type="${f.type === 'text' ? 'text' : 'text'}" value="${esc(f.value ?? '')}" ${f.readOnly ? 'readonly' : ''}>`}
              <p class="error" hidden></p>
            </div>`).join('')}
          ${(spec.checkboxes ?? []).length ? `
            <div class="field" data-field="__days">
              <p class="error" hidden></p>
              <div class="checkbox-row">
                ${(spec.checkboxes ?? []).map((c) => `<label class="checkbox-pill"><input type="checkbox" name="${esc(c.name)}" value="1" ${c.checked ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}
              </div>
            </div>` : ''}
          <div class="dialog-actions">
            <button type="button" class="btn" data-cancel>Cancel</button>
            <button type="submit" class="btn ${spec.confirmClass ?? 'primary'}" data-confirm>${esc(spec.confirmLabel)}</button>
          </div>
        </form>
      </div>`;
    this.overlay = overlay;
    document.body.appendChild(overlay);
    if (spec.bodyNode) {
      const host = overlay.querySelector('[data-custom-body]');
      host?.appendChild(spec.bodyNode);
    }

    const dialog = overlay.querySelector<HTMLElement>('.dialog')!;
    const form = overlay.querySelector('form')!;
    const confirmBtn = overlay.querySelector<HTMLButtonElement>('[data-confirm]')!;
    const cancelBtn = overlay.querySelector<HTMLButtonElement>('[data-cancel]')!;

    const fieldWrap = (name: string) => overlay.querySelector<HTMLElement>(`[data-field="${name}"]`);
    const setError = (name: string, message: string | null) => {
      const wrap = fieldWrap(name);
      if (!wrap) return;
      const err = wrap.querySelector<HTMLElement>('.error')!;
      const control = wrap.querySelector<HTMLElement>('input, select, textarea')!;
      if (message) {
        err.textContent = message;
        err.hidden = false;
        wrap.classList.add('invalid');
        control.setAttribute('aria-invalid', 'true');
        err.id = `err-${name}`;
        control.setAttribute('aria-describedby', err.id);
      } else {
        err.hidden = true;
        wrap.classList.remove('invalid');
        control.removeAttribute('aria-invalid');
      }
    };
    const clearErrors = () => {
      overlay.querySelectorAll('[data-field]').forEach((w) => {
        const wrap = w as HTMLElement;
        const err = wrap.querySelector<HTMLElement>('.error')!;
        err.hidden = true;
        wrap.classList.remove('invalid');
      });
    };

    // Focus inside the dialog (DP-11).
    const firstControl = dialog.querySelector<HTMLElement>('input, select, textarea, button');
    (firstControl ?? dialog).focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
      if (e.key === 'Tab') {
        const focusables = dialog.querySelectorAll<HTMLElement>('input, select, textarea, button, [href]');
        const list = Array.from(focusables).filter((n) => !n.hasAttribute('disabled'));
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    overlay.addEventListener('keydown', trap);

    cancelBtn.addEventListener('click', () => this.close());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.pendingConfirm) return;
      const values: Record<string, string> = {};
      const checks: Record<string, boolean> = {};
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea').forEach((c) => {
        if (c instanceof HTMLInputElement && c.type === 'checkbox') {
          checks[c.name] = c.checked;
        } else {
          values[c.name] = c.value;
        }
      });
      // Collect the checkbox group as a days array under the group name.
      for (const [name, on] of Object.entries(checks)) {
        if (name.startsWith('day:')) {
          const day = name.slice(4);
          const list = (values.__days ?? '').split(',').filter(Boolean);
          if (on) list.push(day);
          values.__days = list.sort().join(',');
        } else if (!Object.keys(values).includes(name)) {
          values[name] = on ? '1' : '';
        }
      }
      this.pendingConfirm = true;
      confirmBtn.disabled = true;
      clearErrors();
      try {
        await spec.onSubmit(values);
        this.close();
      } catch (err) {
        if (err instanceof NetworkError) {
          this.live.problem(err.message);
        } else if (err instanceof ApiError) {
          if (err.code === 'unauthenticated') {
            this.onSessionEnded();
            return;
          }
          this.live.problem(err.message);
          for (const [field, message] of Object.entries(err.fields ?? {})) {
            setError(field, message);
          }
          const focusWrap = overlay.querySelector<HTMLElement>('.field.invalid input, .field.invalid select, .field.invalid textarea');
          (focusWrap as HTMLElement | null)?.focus();
        } else {
          this.live.problem('Keelson could not reach the server. Your last action was not confirmed.');
        }
      } finally {
        this.pendingConfirm = false;
        confirmBtn.disabled = false;
      }
    });
  }

  close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
      this.pendingConfirm = false;
    }
    if (this.lastFocus) {
      const target = this.lastFocus;
      this.lastFocus = null;
      target.focus();
    }
  }

  get isOpen(): boolean {
    return this.overlay !== null;
  }
}

// --------------------------------------------------------- refresh loop

export interface Refresher {
  stop(): void;
  wake(): void;
}

export function every(ms: number, fn: () => Promise<void> | void): Refresher {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stopped) return;
    try { await fn(); } catch { /* transient */ }
    if (stopped) return;
    timer = setTimeout(tick, ms);
  };
  timer = setTimeout(tick, ms);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    wake() {
      if (timer) clearTimeout(timer);
      void tick();
    },
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export { api, newRequestKey, ApiError, NetworkError };
export type { Session };
