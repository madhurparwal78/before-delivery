import { AsyncLocalStorage } from "node:async_hooks";
import { html, raw, type Markup } from "../html.js";
import { icon } from "./art.js";

const ASSET_VERSION = "1";
interface DocumentOptions {
  title: string;
  lang?: string;
  dir?: string;
  kind: "public" | "desk" | "private" | "plain";
  live?: boolean;
  app: Markup;
  overlays?: Markup;
  extraHead?: Markup;
}
export const documentPage = (o: DocumentOptions): string => `<!doctype html>
${html`<html lang="${o.lang ?? "en-GB"}"${raw(o.dir ? ` dir="${o.dir}"` : "")} data-kind="${o.kind}"${raw(o.live ? ' data-live="1"' : "")}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/app.css?v=${ASSET_VERSION}">
<script>document.documentElement.classList.add("js")</script>
${o.extraHead}
<script type="module" src="/assets/js/client/main.js"></script>
</head>
<body>
<div id="app">${o.app}</div>
<div id="overlays">${o.overlays}<div class="scrim" id="scrim" hidden data-client-owned></div></div>
<div id="announcements" class="sr-only" role="region" aria-label="Announcements" aria-live="polite"><span id="said"></span><span id="refresh-said"></span></div>
</body>
</html>`}`;

/** Field ids count up within one page's rendering, each request with its own count. */
const pageIds = new AsyncLocalStorage<{ next: number }>();
export const withPageIds = <T>(render: () => T): T => pageIds.run({ next: 0 }, render);
const nextId = (): string => {
  const ids = pageIds.getStore() as { next: number };
  ids.next += 1;
  return `f${ids.next}`;
};

export const problems = (): Markup => {
  const id = nextId();
  return html`<div class="problems" role="group" aria-labelledby="${id}" tabindex="-1" hidden data-problems data-client-owned><h2 id="${id}">Problems</h2><ul></ul></div>`;
};

interface FieldOptions {
  label: string; name?: string; type?: string; value?: string | number | null; icon?: string; field?: string; autocomplete?: string; dataType?: string; id?: string;
  readonly?: boolean; min?: number; max?: number; step?: string; required?: boolean; inputmode?: string; extra?: string; role?: string; cls?: string; hidden?: boolean; list?: boolean;
}
const attrs = (o: FieldOptions, id: string): Markup => html`id="${id}"${raw(o.name ? html` name="${o.name}"`.text : "")}${raw(o.field ? html` data-field="${o.field}"`.text : "")}${raw(o.dataType ? html` data-type="${o.dataType}"`.text : "")}${raw(o.autocomplete ? html` autocomplete="${o.autocomplete}"`.text : "")}${raw(o.extra ? ` ${o.extra}` : "")}`;

export const textField = (o: FieldOptions): Markup => {
  const id = o.id ?? nextId();
  return html`<div class="field${o.cls ? ` ${o.cls}` : ""}"${raw(o.hidden ? " hidden" : "")}><label for="${id}">${o.label}</label><div class="field-line">${o.icon ? icon(o.icon, 18) : ""}<input ${attrs(o, id)} type="${o.type ?? "text"}"${raw(o.value !== undefined && o.value !== null ? html` value="${o.value}"`.text : "")}${raw(o.min !== undefined ? ` min="${o.min}"` : "")}${raw(o.max !== undefined ? ` max="${o.max}"` : "")}${raw(o.step ? ` step="${o.step}"` : "")}${raw(o.readonly ? " readonly" : "")}${raw(o.inputmode ? ` inputmode="${o.inputmode}"` : "")}></div></div>`;
};
export const areaField = (o: FieldOptions): Markup => {
  const id = o.id ?? nextId();
  return html`<div class="field${o.cls ? ` ${o.cls}` : ""}"${raw(o.hidden ? " hidden" : "")}><label for="${id}">${o.label}</label><div class="field-line">${o.icon ? icon(o.icon, 18) : ""}<textarea ${attrs(o, id)} rows="3">${o.value ?? ""}</textarea></div></div>`;
};
export const selectField = (o: FieldOptions & { options: { value: string; label: string; selected?: boolean }[]; placeholder?: string }): Markup => {
  const id = o.id ?? nextId();
  return html`<div class="field field-select${o.cls ? ` ${o.cls}` : ""}"${raw(o.hidden ? " hidden" : "")}><label for="${id}">${o.label}</label><div class="field-line">${o.icon ? icon(o.icon, 18) : ""}<select ${attrs(o, id)}>${o.placeholder !== undefined ? html`<option value="">${o.placeholder}</option>` : ""}${o.options.map((x) => html`<option value="${x.value}"${raw(x.selected ? " selected" : "")}>${x.label}</option>`)}</select>${icon("chevron", 16)}</div></div>`;
};
export const fileField = (label: string, name: string, field?: string, accept?: string): Markup => {
  const id = nextId();
  return html`<div class="field field-file"><label for="${id}">${label}</label><input id="${id}" type="file" name="${name}"${raw(field ? html` data-field="${field}"`.text : "")}${raw(accept ? html` accept="${accept}"`.text : "")}></div>`;
};
/** A published address combobox: one element with its list drawn by the page. */
export const addressField = (label: string, o: { name?: string; value?: string; field?: string; checked?: boolean; icon?: string; extra?: string }): Markup => {
  const id = nextId();
  return html`<div class="field field-combo"><label for="${id}">${label}</label><div class="field-line">${icon(o.icon ?? "pin", 18)}<input id="${id}" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="street-address" data-address data-checked="${o.checked ? "true" : "false"}"${raw(o.name ? html` name="${o.name}"`.text : "")}${raw(o.field ? html` data-field="${o.field}"`.text : "")}${raw(o.value ? html` value="${o.value}"`.text : "")}${raw(o.extra ? ` ${o.extra}` : "")}></div></div>`;
};
export const radioGroup = (label: string, name: string, options: { value: string; label: string; checked?: boolean }[], o: { field?: string; cls?: string; heading?: boolean; extra?: string } = {}): Markup => {
  const id = nextId();
  return html`<div class="radio-block"${raw(o.extra ? ` ${o.extra}` : "")}><span class="group-label" id="${id}">${label}</span><div class="segments ${o.cls ?? ""}" role="radiogroup" aria-labelledby="${id}"${raw(o.field ? html` data-field="${o.field}"`.text : "")}>${options.map((x) => html`<label class="segment"><input type="radio" name="${name}" value="${x.value}"${raw(x.checked ? " checked" : "")}><span>${x.label}</span></label>`)}</div></div>`;
};
export const hourOptions = (from = 0, to = 23): { value: string; label: string }[] =>
  Array.from({ length: to - from + 1 }, (_, i) => { const t = String(from + i).padStart(2, "0"); return { value: t, label: t }; });
export const minuteOptions = (quarters: boolean): { value: string; label: string }[] =>
  Array.from({ length: quarters ? 4 : 60 }, (_, i) => { const t = String(quarters ? i * 15 : i).padStart(2, "0"); return { value: t, label: t }; });

interface DialogOptions { id: string; title: string; kind?: "dialog" | "sheet" | "panel" | "search"; body: Markup; closeLabel?: string; titleLang?: string }
export const dialog = (o: DialogOptions): Markup => {
  const titleId = `${o.id}-title`;
  return html`<div class="dialog dialog-${o.kind ?? "dialog"}" id="${o.id}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" hidden data-kind="${o.kind ?? "dialog"}">
    <header class="dialog-head"><h2 id="${titleId}" data-dialog-title>${o.title}</h2><button type="button" class="btn-plain" data-close>${o.closeLabel ?? "Close"}</button></header>
    ${o.body}</div>`;
};
export const formAttrs = (api: string, ok?: string, flags = ""): Markup => raw(html`data-api="${api}"${raw(ok ? html` data-ok="${ok}"`.text : "")}`.text + (flags ? ` ${flags}` : "") + " novalidate");
