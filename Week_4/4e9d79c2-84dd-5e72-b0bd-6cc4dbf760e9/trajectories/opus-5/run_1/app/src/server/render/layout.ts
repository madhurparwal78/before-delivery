export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type PageShell = {
  title: string;
  language?: 'en' | 'pl' | 'ur';
  bodyClass?: string;
  main: string;
  before?: string;
  after?: string;
  data?: Record<string, unknown>;
};

const ANNOUNCEMENTS = `<div class="announcements" role="region" aria-label="Announcements" aria-live="polite" data-part="announcements"></div>`;

export function shell(page: PageShell): string {
  const language = page.language ?? 'en';
  const direction = language === 'ur' ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${language}" dir="${direction}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<link rel="stylesheet" href="/app.css">
<link rel="preload" href="/fonts/poppins-600.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body class="${page.bodyClass ?? ''}" data-language="${language}">
${ANNOUNCEMENTS}
${page.before ?? ''}
<main id="main" class="main">${page.main}</main>
${page.after ?? ''}
<script type="application/json" id="page-data">${JSON.stringify(page.data ?? {}).replace(/</g, '\\u003c')}</script>
<script type="module" src="/app.js"></script>
</body>
</html>`;
}

export function problems(): string {
  return `<div class="problems" role="group" aria-labelledby="problems-heading" data-part="problems" hidden>
  <h2 id="problems-heading">Problems</h2>
  <ul class="problems-list"></ul>
</div>`;
}

export function refreshLine(place = ''): string {
  return `<p class="refresh-line" data-part="refresh-line" hidden>${place}</p>`;
}

export function field(options: {
  id: string;
  label: string;
  type?: string;
  value?: string;
  name?: string;
  autocomplete?: string;
  icon?: string;
  inputMode?: string;
  extra?: string;
}): string {
  const type = options.type ?? 'text';
  return `<div class="field underline-field">
  <label for="${options.id}">${escapeHtml(options.label)}</label>
  <span class="field-icon" aria-hidden="true">${options.icon ?? iconLine()}</span>
  <input id="${options.id}" name="${options.name ?? options.id}" type="${type}" value="${escapeHtml(options.value ?? '')}"
    ${options.autocomplete ? `autocomplete="${options.autocomplete}"` : ''}
    ${options.inputMode ? `inputmode="${options.inputMode}"` : ''} ${options.extra ?? ''}>
</div>`;
}

export function numberField(options: { id: string; label: string; value?: string; min: number; max: number }): string {
  return `<div class="field underline-field">
  <label for="${options.id}">${escapeHtml(options.label)}</label>
  <span class="field-icon" aria-hidden="true">${iconLine()}</span>
  <input id="${options.id}" name="${options.id}" type="number" inputmode="numeric" min="${options.min}" max="${options.max}"
    value="${escapeHtml(options.value ?? '')}">
</div>`;
}

export function selectField(options: {
  id: string;
  label: string;
  values: { value: string; label: string; selected?: boolean }[];
}): string {
  const choices = options.values
    .map(
      (choice) =>
        `<option value="${escapeHtml(choice.value)}"${choice.selected ? ' selected' : ''}>${escapeHtml(choice.label)}</option>`,
    )
    .join('');
  return `<div class="field underline-field select-field">
  <label for="${options.id}">${escapeHtml(options.label)}</label>
  <span class="field-icon" aria-hidden="true">${iconLine()}</span>
  <select id="${options.id}" name="${options.id}">${choices}</select>
  <span class="chevron" aria-hidden="true">${iconChevron()}</span>
</div>`;
}

export function radioGroup(options: {
  name: string;
  legend: string;
  values: { value: string; label: string; checked?: boolean }[];
  className?: string;
}): string {
  const items = options.values
    .map(
      (choice, index) => `<label class="segment">
  <input type="radio" name="${options.name}" value="${escapeHtml(choice.value)}"${
    choice.checked || (index === 0 && !options.values.some((other) => other.checked)) ? ' checked' : ''
  }>
  <span>${escapeHtml(choice.label)}</span>
</label>`,
    )
    .join('');
  return `<fieldset class="segmented ${options.className ?? ''}" role="radiogroup" aria-label="${escapeHtml(options.legend)}">
  <legend>${escapeHtml(options.legend)}</legend>${items}
</fieldset>`;
}

export function combobox(options: { id: string; label: string; value?: string }): string {
  return `<div class="field underline-field combobox" data-combobox>
  <label for="${options.id}">${escapeHtml(options.label)}</label>
  <span class="field-icon" aria-hidden="true">${iconPin()}</span>
  <input id="${options.id}" name="${options.id}" type="text" role="combobox" aria-expanded="false"
    aria-autocomplete="list" aria-controls="${options.id}-list" autocomplete="street-address"
    value="${escapeHtml(options.value ?? '')}">
  <ul class="combobox-list" id="${options.id}-list" role="listbox" aria-label="${escapeHtml(options.label)}" hidden></ul>
</div>`;
}

export function dialog(options: { id: string; title: string; body: string; actions: string }): string {
  return `<div class="dialog-holder" data-dialog="${options.id}" hidden>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.title)}" data-dialog-box>
    <h2>${escapeHtml(options.title)}</h2>
    ${problems()}
    <div class="dialog-body">${options.body}</div>
    <div class="dialog-actions">${options.actions}<button type="button" data-close>Close</button></div>
  </div>
</div>`;
}

export function sheet(options: { id: string; title: string; body: string; actions: string }): string {
  return `<div class="dialog-holder sheet-holder" data-dialog="${options.id}" data-sheet hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.title)}" data-dialog-box>
    <h2>${escapeHtml(options.title)}</h2>
    ${problems()}
    <div class="dialog-body">${options.body}</div>
    <div class="dialog-actions">${options.actions}<button type="button" data-close>Close</button></div>
  </div>
</div>`;
}

export function iconLine(): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/></svg>`;
}

export function iconChevron(): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>`;
}

export function iconPin(): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
}

export function iconCheck(): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 13l5 5L20 6"/></svg>`;
}

export function iconDesk(): string {
  return `<svg viewBox="0 0 48 48" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="10" width="36" height="24"/><path d="M6 34v6M42 34v6M14 18h20M14 24h12"/></svg>`;
}
