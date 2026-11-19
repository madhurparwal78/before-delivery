import {
  ApiFailure,
  ErrorBody,
  Namespace,
  Rejection,
  request,
  Role,
  ServerUnreachable,
  UNREACHABLE,
} from '../api.js';
import { clearFieldErrors, el, setFieldError } from '../dom.js';
import { settings } from '../settings.js';
import { formatDate, formatFern, formatTime } from '../../shared/format.js';
import { badEncodingRejectionCopy, withheldRejectionCopy } from '../../shared/live.js';

export const VIEWER_COPY = "Viewers can't make changes in this workspace.";
export const PRODUCER_COPY = 'Only the owner can change producer behaviour.';
export const MEMBERS_COPY = 'Only the owner can manage members.';
export const TRANSACTION_SENT = 'Transaction sent. It takes effect when the next block is produced.';

export type WriteScope = 'producer' | 'members' | 'transaction';

export function roleRefusal(role: Role, scope: WriteScope): string | null {
  if (role === 'viewer') return VIEWER_COPY;
  if (role === 'developer' && scope === 'producer') return PRODUCER_COPY;
  if (role === 'developer' && scope === 'members') return MEMBERS_COPY;
  return null;
}

/** Controls a role cannot use stay visible, disabled and described. */
export function disableForRole(container: HTMLElement, copy: string | null, id: string): void {
  if (!copy) return;
  container.appendChild(el('p', { class: 'field-note', attrs: { id }, text: copy }));
  for (const control of container.querySelectorAll<HTMLElement>(
    'button, input, select, textarea',
  )) {
    control.setAttribute('disabled', '');
    control.setAttribute('aria-describedby', id);
  }
}

export function fern(ufern: number): string {
  return formatFern(BigInt(ufern));
}

export function time(iso: string): string {
  return formatTime(iso, settings.timeZone);
}

export function dateTime(iso: string): string {
  return `${formatDate(iso, settings.timeZone)} ${formatTime(iso, settings.timeZone)}`;
}

export function namespaceNames(namespaces: Namespace[]): Map<string, string> {
  return new Map(namespaces.map((namespace) => [namespace.hex, namespace.name]));
}

export function rejectionText(height: number, rejection: Rejection): string {
  return rejection.reason === 'withheld'
    ? withheldRejectionCopy(height, rejection.nodeName, rejection.row, rejection.col)
    : badEncodingRejectionCopy(height, rejection.axis, rejection.index);
}

export function rejectionBanner(height: number, rejection: Rejection): HTMLElement {
  return el('p', {
    class: 'banner',
    attrs: { role: 'alert', 'aria-label': `Block ${height} rejected` },
    text: rejectionText(height, rejection),
  });
}

export interface FormParts {
  form: HTMLFormElement;
  alert: HTMLElement;
  status: HTMLElement;
  button: HTMLButtonElement;
}

export const STORAGE_SUBMIT_COPY =
  "Storage is unavailable, so blobs can't be submitted right now. The explorer still works.";
export const STORAGE_SNAPSHOT_COPY =
  "Storage is unavailable, so the snapshot can't be downloaded right now.";

/** The full-container outage banner, shown once above the page's panels. */
export function outageBanner(main: HTMLElement, copy: string): void {
  const container = main.querySelector('.container') ?? main;
  const existing = container.querySelector('[data-outage]');
  if (existing) {
    existing.textContent = copy;
    return;
  }
  container.insertBefore(
    el('p', { class: 'banner', attrs: { role: 'alert' }, data: { outage: 'true' }, text: copy }),
    container.firstChild,
  );
}

export interface FormOptions {
  name: string;
  heading?: string;
  /** Pass a shared region when several forms report into one status. */
  statusRegion?: HTMLElement;
  statusName: string;
  submitLabel: string;
  fields: (HTMLElement | null)[];
  role: Role;
  scope: WriteScope;
  onSubmit: (form: HTMLFormElement) => Promise<string>;
  onFailure?: (status: number, copy: string) => void;
}

/** One form landmark with its alert, status region and single primary pill. */
export function buildForm(options: FormOptions): FormParts {
  const alert = el('p', { class: 'alert-area', attrs: { role: 'alert' } });
  const status =
    options.statusRegion ??
    el('p', {
      class: 'status-area',
      attrs: { role: 'status', 'aria-label': options.statusName, 'aria-live': 'polite' },
    });
  const button = el(
    'button',
    { class: 'pill pill-primary', attrs: { type: 'submit' } },
    options.submitLabel,
  ) as HTMLButtonElement;
  const controls = el('div', {}, [
    ...options.fields.filter((node): node is HTMLElement => node !== null),
    button,
  ]);
  const form = el('form', {
    class: 'form-panel',
    attrs: { 'aria-label': options.name, novalidate: true },
  }) as HTMLFormElement;
  if (options.heading) form.appendChild(el('h2', { class: 'form-heading', text: options.heading }));
  form.append(alert, controls);
  if (!options.statusRegion) form.appendChild(status);
  const roleNoteId = `${options.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-role-note`;
  disableForRole(controls, roleRefusal(options.role, options.scope), roleNoteId);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    alert.textContent = '';
    button.setAttribute('disabled', '');
    button.setAttribute('aria-busy', 'true');
    status.textContent = 'Working…';
    void options
      .onSubmit(form)
      .then((copy) => {
        status.textContent = copy;
      })
      .catch((error: unknown) => {
        status.textContent = '';
        if (error instanceof ServerUnreachable) {
          alert.textContent = UNREACHABLE;
          return;
        }
        if (error instanceof ApiFailure) {
          const body = error.body as ErrorBody;
          if (body.errors) {
            const [field, message] = Object.entries(body.errors)[0];
            alert.textContent = message;
            setFieldError(form, field, message);
            return;
          }
          const copy = body.error ?? 'That did not work.';
          alert.textContent = copy;
          options.onFailure?.(error.status, copy);
          return;
        }
        alert.textContent = 'That did not work.';
      })
      .finally(() => {
        button.removeAttribute('disabled');
        button.removeAttribute('aria-busy');
      });
  });

  return { form, alert, status, button };
}

export async function submitJson<T>(
  path: string,
  body: unknown,
  method = 'POST',
): Promise<T> {
  const result = await request<T>(path, { method, body });
  if (result.status >= 400) throw new ApiFailure(result.status, result.body);
  return result.body;
}

export function textbox(
  id: string,
  fieldName: string,
  options: { value?: string; placeholder?: string; type?: string } = {},
): HTMLInputElement {
  return el('input', {
    attrs: {
      id,
      name: id,
      type: options.type ?? 'text',
      value: options.value ?? '',
      placeholder: options.placeholder ?? '',
      autocomplete: 'off',
      spellcheck: 'false',
    },
    data: { field: fieldName },
  }) as HTMLInputElement;
}

export function textArea(id: string, fieldName: string): HTMLTextAreaElement {
  return el('textarea', {
    attrs: { id, name: id, spellcheck: 'false' },
    data: { field: fieldName },
  }) as HTMLTextAreaElement;
}

export function selectBox(
  id: string,
  fieldName: string,
  label: string,
  options: { value: string; label: string }[],
): HTMLSelectElement {
  const select = el('select', {
    attrs: { id, name: id, 'aria-label': label },
    data: { field: fieldName },
  }) as HTMLSelectElement;
  for (const option of options) {
    select.appendChild(el('option', { attrs: { value: option.value } }, option.label));
  }
  return select;
}
