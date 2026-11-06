// API client, notices, dialogs and small DOM helpers.
import type { ApiErrorBody, Member } from "./types.js";

export interface ApiErrorEnvelope {
  error?: { code: string; message: string; fields?: Record<string, string> };
}

export interface ApiResult<T> {
  status: number;
  body: T & ApiErrorEnvelope;
  headers: Record<string, string>;
}

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown, opts?: { headers?: Record<string, string>; raw?: boolean }): Promise<ApiResult<T & ApiErrorEnvelope>> {
  const init: RequestInit = {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(opts?.headers ?? {}) },
    credentials: "same-origin",
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    // A network failure is reported as status 0 so callers can resend once.
    return { status: 0, body: {} as T & ApiErrorEnvelope, headers: {} };
  }
  const text = await res.text();
  let parsed: unknown = text;
  if (!opts?.raw) {
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  return { status: res.status, body: parsed as T & ApiErrorEnvelope, headers };
}

export async function uploadImage(file: File): Promise<{ status: number; body: { asset?: unknown; error?: ApiErrorBody["error"] } }> {
  const buf = await file.arrayBuffer();
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: buf,
    credentials: "same-origin",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body: body as { asset?: unknown; error?: ApiErrorBody["error"] } };
}

// ---------------------------------------------------------------------------
// DOM helpers

export type Child = Node | string | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, unknown>, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "text") el.textContent = String(v);
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === "dataset" && typeof v === "object" && v !== null) {
        for (const [dk, dv] of Object.entries(v as Record<string, string>)) (el as HTMLElement).dataset[dk] = dv;
      } else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else el.appendChild(c as Node);
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ---------------------------------------------------------------------------
// Notices

const noticeRegion = document.getElementById("notice-region") as HTMLElement;
const alertRegion = document.getElementById("alert-region") as HTMLElement;

function push(region: HTMLElement, text: string, timeoutMs = 10000): void {
  const item = h("div", { text });
  region.appendChild(item);
  window.setTimeout(() => item.remove(), timeoutMs);
}

export function notice(text: string): void {
  push(noticeRegion, text);
}

export function alertNotice(text: string): void {
  push(alertRegion, text, 12000);
}

export function fieldErrorsOf(err: ApiErrorBody): Record<string, string> {
  return err.error?.fields ?? {};
}

export function alertFromError(err: ApiErrorBody): void {
  alertNotice(err.error?.message ?? "Something went wrong.");
}

// ---------------------------------------------------------------------------
// Dialogs

interface DialogHandle {
  close(): void;
}

const dialogLayer = document.getElementById("dialog-layer") as HTMLElement;
let openDialogs: { el: HTMLElement; opener: HTMLElement | null; onClose?: () => void }[] = [];

export function openDialog(opts: {
  label: string;
  build(body: HTMLElement): void;
  onClose?(): void;
  alertStyle?: boolean;
}): DialogHandle {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialogEl = h("div", { class: "dialog", role: opts.alertStyle ? "alertdialog" : "dialog", "aria-label": opts.label });
  const backdrop = h("div", { class: "dialog-backdrop" }, dialogEl);
  const entry = { el: dialogEl, opener, onClose: opts.onClose };
  const close = () => {
    backdrop.remove();
    openDialogs = openDialogs.filter((d) => d.el !== dialogEl);
    document.removeEventListener("keydown", onKey);
    if (openDialogs.length === 0) document.body.style.removeProperty("overflow");
    if (entry.onClose) entry.onClose();
    if (opener && openDialogs.length === 0) opener.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      keepFocus(e, dialogEl);
    }
  };
  dialogLayer.appendChild(backdrop);
  openDialogs.push(entry);
  document.body.style.setProperty("overflow", "hidden");
  document.addEventListener("keydown", onKey, true);
  opts.build(dialogEl);
  const focusables = dialogEl.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
  (focusables[0] ?? dialogEl).focus();
  return { close };
}

function keepFocus(e: KeyboardEvent, dialogEl: HTMLElement): void {
  const focusables = Array.from(dialogEl.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter(
    (f) => !f.hasAttribute("disabled") && f.offsetParent !== null,
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ---------------------------------------------------------------------------
// Formatting

export function fmtCredits(micro: number): string {
  const cents = Math.round(micro / 10000);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

export function fmtRate(micro: number): string {
  return (micro / 1_000_000).toFixed(6);
}

export function fmtWholeCredits(credits: number): string {
  return Math.round(credits).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function fmtUnitsDisplay(unit: string, units: string): string {
  const n = Number(units);
  switch (unit) {
    case "image":
      return String(Math.round(n));
    case "megapixel":
      return n.toFixed(2);
    default:
      return n.toFixed(1);
  }
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function stateWord(state: string): string {
  if (state === "active") return "Active";
  if (state === "failing") return "Failing";
  return "Disabled";
}

export function currentMember(): Promise<Member | null> {
  return api<{ member: Member }>("GET", "/api/me").then((r) => (r.status === 200 ? r.body.member : null));
}
