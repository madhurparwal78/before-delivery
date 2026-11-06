import { attrs, html, raw, type RawHtml, type Renderable } from './html.ts';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldOptions {
  name: string;
  label: string;
  kind?: 'text' | 'password' | 'email' | 'number' | 'textarea' | 'select' | 'checkbox' | 'file';
  value?: string;
  checked?: boolean;
  options?: readonly SelectOption[];
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  placeholder?: string;
  autocomplete?: string;
  hint?: string;
  inputmode?: string;
}

/**
 * One form field with its label, its inline error and the describedby wiring. No field carries a
 * browser maximum length or required flag, so every check comes back from the server.
 */
export function field(options: FieldOptions): RawHtml {
  const id = `f-${options.name}`;
  const errorId = `e-${options.name}`;
  const kind = options.kind ?? 'text';
  const shared = {
    id,
    name: options.name,
    class: 'field__control',
    'aria-describedby': errorId,
    'data-field-control': options.name,
    autocomplete: options.autocomplete ?? null,
    inputmode: options.inputmode ?? null,
    placeholder: options.placeholder ?? null,
  };

  let control: RawHtml;
  if (kind === 'textarea') {
    control = html`<textarea${attrs({ ...shared, rows: options.rows ?? 4 })}>${options.value ?? ''}</textarea>`;
  } else if (kind === 'select') {
    control = html`<select${attrs(shared)}>${(options.options ?? []).map(
      (option) =>
        html`<option${attrs({ value: option.value, selected: option.value === options.value })}>${option.label}</option>`,
    )}</select>`;
  } else if (kind === 'checkbox') {
    control = html`<input${attrs({ ...shared, type: 'checkbox', checked: options.checked === true })}>`;
  } else if (kind === 'number') {
    control = html`<input${attrs({
      ...shared,
      type: 'number',
      value: options.value ?? '0',
      min: options.min ?? 0,
      max: options.max ?? null,
      step: options.step ?? 1,
    })}>`;
  } else if (kind === 'file') {
    control = html`<input${attrs({ ...shared, type: 'file' })}>`;
  } else {
    control = html`<input${attrs({ ...shared, type: kind, value: options.value ?? '' })}>`;
  }

  const labelFirst = kind !== 'checkbox';
  return html`<div class="field field--${kind}" data-field="${options.name}">
  ${labelFirst ? html`<label class="field__label" for="${id}">${options.label}</label>` : raw('')}
  ${control}
  ${labelFirst ? raw('') : html`<label class="field__label" for="${id}">${options.label}</label>`}
  ${options.hint === undefined ? raw('') : html`<p class="field__hint">${options.hint}</p>`}
  <p class="field__error" id="${errorId}" data-field-error="${options.name}" hidden></p>
</div>`;
}

export function radioGroup(
  name: string,
  label: string,
  options: readonly SelectOption[],
  value: string,
): RawHtml {
  return html`<fieldset class="field field--radio" data-field="${name}">
  <legend class="field__label">${label}</legend>
  ${options.map(
    (option) => html`<label class="radio"><input${attrs({
      type: 'radio',
      name,
      value: option.value,
      checked: option.value === value,
      'data-field-control': name,
    })}><span>${option.label}</span></label>`,
  )}
  <p class="field__error" data-field-error="${name}" hidden></p>
</fieldset>`;
}

export interface TableOptions {
  name: string;
  columns: readonly string[];
  rows: readonly RawHtml[];
  className?: string;
  bodyAttributes?: Record<string, string>;
}

/** A named table that renders with its accessible name even when it has no rows. */
export function table(options: TableOptions): RawHtml {
  // A table that scrolls sideways is focusable, so it can be reached by keyboard alone.
  return html`<div class="table-wrap${options.className === undefined ? '' : ` ${options.className}`}" tabindex="0">
<table class="table" aria-label="${options.name}" data-table="${options.name}">
  <thead><tr>${options.columns.map((column) => html`<th scope="col">${column}</th>`)}</tr></thead>
  <tbody${attrs(options.bodyAttributes ?? {})}>${
    options.rows.length === 0
      ? html`<tr class="table__empty"><td colspan="${options.columns.length}">Nothing here yet.</td></tr>`
      : options.rows
  }</tbody>
</table>
</div>`;
}

export interface DialogOptions {
  name: string;
  body: Renderable;
  actions: Renderable;
  className?: string;
}

/** A modal dialog with the alert its refusals move focus to. */
export function dialog(options: DialogOptions): RawHtml {
  return html`<dialog class="dialog${options.className === undefined ? '' : ` ${options.className}`}" aria-label="${options.name}" data-dialog="${options.name}">
  <form class="dialog__form" method="dialog" data-dialog-form="${options.name}">
    <h2 class="dialog__heading">${options.name}</h2>
    <p class="dialog__alert" role="alert" tabindex="-1" data-dialog-alert hidden></p>
    <div class="dialog__body">${options.body}</div>
    <div class="dialog__actions">${options.actions}</div>
  </form>
</dialog>`;
}

export function button(
  label: string,
  options: { variant?: 'primary' | 'quiet' | 'danger'; action?: string; type?: string; pending?: string; attributes?: Record<string, string | number | boolean | null> } = {},
): RawHtml {
  return html`<button${attrs({
    type: options.type ?? 'button',
    class: `button button--${options.variant ?? 'primary'}`,
    'data-action': options.action ?? null,
    'data-pending-copy': options.pending ?? null,
    ...(options.attributes ?? {}),
  })}>${label}</button>`;
}

export function link(
  label: string,
  href: string,
  options: { variant?: string; attributes?: Record<string, string | number | boolean | null> } = {},
): RawHtml {
  return html`<a${attrs({
    href,
    class: options.variant === undefined ? 'link' : `link link--${options.variant}`,
    ...(options.attributes ?? {}),
  })}>${label}</a>`;
}

export function panel(heading: string | null, body: Renderable, options: { className?: string; headingLevel?: 2 | 3 } = {}): RawHtml {
  const level = options.headingLevel ?? 2;
  return html`<section class="panel${options.className === undefined ? '' : ` ${options.className}`}">
  ${heading === null ? raw('') : level === 2 ? html`<h2 class="panel__heading">${heading}</h2>` : html`<h3 class="panel__heading">${heading}</h3>`}
  ${body}
</section>`;
}

export function stickyBar(body: Renderable): RawHtml {
  return html`<div class="sticky-bar" data-sticky-bar>${body}</div>`;
}

export function pageData(data: unknown): RawHtml {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return raw(`<script type="application/json" data-page-data>${json}</script>`);
}

export function mono(value: string): RawHtml {
  return html`<span class="mono">${value}</span>`;
}
