/**
 * Screen wiring helpers: element building, API access, money and date display,
 * and the pack facts mirror. Every price fact comes from the server's price
 * decision; the browser computes no price or date.
 */

export type Json = Record<string, unknown>;

export function el(tag: string, attrs: Record<string, string | null> = {}, ...children: Array<Node | string | null>): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value') (node as unknown as HTMLInputElement).value = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

export function input(attrs: Record<string, string | null> = {}): HTMLInputElement {
  const node = document.createElement('input');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'value') node.value = v;
    else if (k === 'text') node.placeholder = v;
    else node.setAttribute(k, v);
  }
  return node;
}

export function canvas(attrs: Record<string, string | null> = {}): HTMLCanvasElement {
  const node = document.createElement('canvas');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  return node;
}

export function dialog(attrs: Record<string, string | null> = {}): HTMLDialogElement {
  const node = document.createElement('dialog');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  return node;
}

export function select(attrs: Record<string, string | null> = {}): HTMLSelectElement {
  const node = document.createElement('select');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v);
  }
  return node;
}

export function option(value: string, text: string): HTMLOptionElement {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
}

export async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { ok: res.ok, status: res.status, body: body as T };
}

/** `Rs <rupees>` always has two decimals. */
export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  const sign = paise < 0 ? '-' : '';
  const a = Math.abs(paise);
  return `${sign}Rs ${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Every date on a public surface is formatted from the server's YYYY-MM-DD string. */
export function displayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export interface PackFacts {
  batchCode: string;
  skuCode: string;
  drinkName: string;
  skuName: string;
  format: string;
  sizeMl: number;
  packedDate: string;
  printDate: string;
  oldWrapper: boolean;
  wrapperNotice: { number: string; version: number } | null;
  bestBeforeDate: string;
  printedMrpPaise: number;
  revisedMrpPaise: number | null;
  retailPricePaise: number;
  unitSalePrice: { rupees: string; per: string } | null;
  sugarMgPerPack: number;
  stickerApplies: boolean;
  stickerNote: string | null;
  pastBestBefore: boolean;
  dateNote: string | null;
  sourceNotice: { number: string; version: number } | null;
}

export function sugarGrams(mg: number): string {
  const tenths = Math.floor((mg / 100) * 10 + 0.5);
  return `${Math.floor(tenths / 10)}.${tenths % 10} g`;
}

/** The mirror states the same facts as the panel. */
export function setMirror(container: HTMLElement, facts: PackFacts): void {
  container.textContent = '';
  const dl = el('dl', { class: 'facts-list' });
  const add = (term: string, value: string, note?: string): void => {
    const div = el('div', { class: 'fact' });
    div.appendChild(el('dt', { text: term }));
    div.appendChild(el('dd', { text: value }));
    if (note) div.appendChild(el('dd', { class: 'fact-note', text: note }));
    dl.appendChild(div);
  };
  add('Batch', facts.batchCode);
  add('Printed MRP', rupees(facts.printedMrpPaise));
  add('Revised MRP', facts.revisedMrpPaise === null ? 'None' : rupees(facts.revisedMrpPaise));
  if (facts.unitSalePrice) add('Unit sale price', `Rs ${facts.unitSalePrice.rupees} per ${facts.unitSalePrice.per}`);
  add('Packed', displayDate(facts.packedDate));
  add('Best before', displayDate(facts.bestBeforeDate));
  add('Sugar per pack', sugarGrams(facts.sugarMgPerPack));
  add('Wrapper', facts.wrapperNotice ? `Old wrapper under ${facts.wrapperNotice.number} v${facts.wrapperNotice.version}` : 'Current print', facts.stickerNote ?? undefined);
  if (facts.dateNote) add('Note', facts.dateNote);
  container.appendChild(dl);
  if (facts.wrapperNotice) {
    container.appendChild(el('a', { href: `/notices/${facts.wrapperNotice.number}`, class: 'download-link', text: `Read notice ${facts.wrapperNotice.number}` }));
  }
}

export interface CatalogueSku {
  code: string;
  variant: string;
  name: string;
  format: string;
  sizeMl: number;
  shelfDays: number;
  sugarMgPerPack: number;
  currentMrpPaise: number;
}
export interface CatalogueDrink {
  id: string;
  name: string;
  carbonated: boolean;
  skus: CatalogueSku[];
}
export interface Catalogue {
  today: string;
  counts: { drinks: number; skus: number; notices: number; scheduledRevisions: number };
  drinks: CatalogueDrink[];
}
export interface SearchEntry {
  kind: string;
  skuCode: string;
  name: string;
  batchCode: string | null;
  retailPricePaise: number;
  sourceNotice: { number: string; version: number } | null;
}
export interface NoticeVersion {
  version: number;
  state: string;
  supersededBy: number | null;
  title: string;
  effectiveDate: string;
  runOutUntil: string | null;
  publishedAt: string;
  reason: string | null;
  printState: string;
  pdfSha256: string | null;
  sheet: { id: string; sha256: string } | null;
  rows: Array<{ skuCode: string; name: string; kind: string; oldMrpPaise: number; revisedMrpPaise: number; oldRate: number | null; newRate: number | null; ceilingPaise: number | null }>;
}
