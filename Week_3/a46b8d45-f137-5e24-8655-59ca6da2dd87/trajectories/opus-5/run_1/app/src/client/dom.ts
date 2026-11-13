/**
 * Browser plumbing: the page's data, its one status region and one alert region, the
 * language switch, and talking to the API.
 *
 * This code never compares a server instant with the device clock to decide a status: it
 * renders the status the server returned.
 */

import { ownerFieldErrorFor } from '../shared/copy';
import type { Language } from '../shared/format';

type Pair = Record<Language, string>;

export interface DeskCopy {
  refusals: Record<string, Pair>;
  fields: Record<string, Pair>;
  pending: Record<string, Pair>;
  states: Record<string, Pair>;
}

export interface DeskData {
  language: Language;
  copy: DeskCopy;
  sentReference?: string;
  confirmToken?: string;
  shareToken?: string;
  reference?: string;
  noticesPending?: number;
}

let data: DeskData;

export function deskData(): DeskData {
  if (data === undefined) {
    const holder = document.getElementById('desk-data');
    data = JSON.parse(holder?.textContent ?? '{}') as DeskData;
  }
  return data;
}

export function language(): Language {
  return (document.body.dataset['language'] as Language) ?? 'en-GB';
}

export function find<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function findAll<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/* ------------------------------------------------------------------------ live regions */

function statusRegion(): HTMLElement | null {
  return document.getElementById('desk-status');
}

function alertRegion(): HTMLElement | null {
  return document.getElementById('desk-alert');
}

/** Pending, success and waiting-notice messages go to the one general status region. */
export function showStatus(message: string): void {
  const region = statusRegion();
  if (region !== null) region.textContent = message;
}

export function clearStatus(): void {
  showStatus('');
}

/** Refusals and outages go to the one alert region. */
export function showAlert(message: string, moveFocus = false): void {
  const region = alertRegion();
  if (region === null) return;
  region.textContent = message;
  if (moveFocus) region.focus();
}

/** A successful retry empties the stale alert. */
export function clearAlert(): void {
  const region = alertRegion();
  if (region !== null) region.textContent = '';
}

/* -------------------------------------------------------------------------- the copy */

export function refusalText(code: string, params: { file?: string; number?: number | string } = {}): string {
  const pair = deskData().copy.refusals[code];
  let text = pair === undefined ? code : pair[language()];
  if (params.file !== undefined) text = text.replace('<file>', params.file);
  if (params.number !== undefined) text = text.replace('<number>', String(params.number));
  return text;
}

export function fieldErrorText(field: string): string {
  const name = ownerFieldErrorFor(field);
  if (name === null) return '';
  const pair = deskData().copy.fields[name];
  return pair === undefined ? '' : pair[language()];
}

export function pendingText(moment: string): string {
  const pair = deskData().copy.pending[moment];
  return pair === undefined ? '' : pair[language()];
}

/* ------------------------------------------------------------------------- API calls */

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  state?: string;
}

export class ApiRefusal extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.code);
    this.name = 'ApiRefusal';
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; fields?: Record<string, string>; state?: string };
}

export async function callApi<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    form?: FormData;
    /** A body sent as it is, such as the supplier CSV. */
    raw?: { text: string; contentType: string };
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.raw !== undefined) {
    headers['content-type'] = options.raw.contentType;
    body = options.raw.text;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, { method: options.method ?? 'GET', headers, body });
  } catch {
    // A request that never reached the desk is reported as a records outage.
    throw new ApiRefusal({ status: 503, code: 'database_unavailable', message: '' });
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!response.ok) {
    let envelope: ErrorEnvelope = {};
    try {
      envelope = JSON.parse(text) as ErrorEnvelope;
    } catch {
      envelope = {};
    }
    throw new ApiRefusal({
      status: response.status,
      code: envelope.error?.code ?? 'desk_error',
      message: envelope.error?.message ?? '',
      fields: envelope.error?.fields,
      state: envelope.error?.state,
    });
  }
  return (text === '' ? undefined : (JSON.parse(text) as T)) as T;
}

/* --------------------------------------------------------------- the language switch */

/** Swaps every owner string in place, without a reload and without moving the page. */
export function applyLanguage(next: Language): void {
  const attribute = next === 'en-GB' ? 'data-en' : 'data-pl';
  const labelAttribute = next === 'en-GB' ? 'data-en-label' : 'data-pl-label';

  for (const element of findAll<HTMLElement>(`[${attribute}]`)) {
    const value = element.getAttribute(attribute);
    if (value !== null) element.textContent = value;
  }
  for (const element of findAll<HTMLElement>(`[${labelAttribute}]`)) {
    const value = element.getAttribute(labelAttribute);
    if (value !== null) element.setAttribute('aria-label', value);
  }

  document.body.dataset['language'] = next;
  document.documentElement.setAttribute('lang', next);
  document.cookie = `desk_language=${next}; Path=/; Max-Age=31536000; SameSite=Strict`;
}

export function wireLanguageSwitch(): void {
  for (const radio of findAll<HTMLInputElement>('.language-radio')) {
    radio.addEventListener('change', () => {
      if (radio.checked) applyLanguage(radio.value as Language);
    });
  }
}

/** Every action button is disabled from the moment it is pressed until its answer arrives. */
export async function whilePressed<T>(button: HTMLButtonElement | null, work: () => Promise<T>): Promise<T> {
  if (button !== null) button.disabled = true;
  try {
    return await work();
  } finally {
    if (button !== null) button.disabled = false;
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
