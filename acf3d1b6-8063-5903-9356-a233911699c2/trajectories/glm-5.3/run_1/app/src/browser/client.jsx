// Client helpers: API calls, formatting, focus trapping and shared UI components.
import { useEffect, useRef } from 'preact/hooks';

const TOKEN_KEY = 'kinora_token';
const TRY_KEY = 'kinora_try_prompt';

export const fmtCredits = (n) => n.toLocaleString('en-US');
export const fmtSigned = (n) => (n >= 0 ? `+${n.toLocaleString('en-US')}` : n.toLocaleString('en-US'));
export const fmtMoney = (cents) => `$${Math.round(cents / 100)}`;

export const utcDateTime = (iso) => {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
};

export const utcDate = (iso) => new Date(iso).toISOString().slice(0, 10);

export function dayHeading(iso, now = new Date()) {
  const d = new Date(iso);
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  const day = new Date(d); day.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${day.getUTCDate()} ${months[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
}

// ---------------------------------------------------------------- tokens

export function saveToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
}

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

export function saveTryPrompt(prompt) {
  try { sessionStorage.setItem(TRY_KEY, prompt); } catch {}
}

export function takeTryPrompt() {
  try {
    const p = sessionStorage.getItem(TRY_KEY);
    sessionStorage.removeItem(TRY_KEY);
    return p;
  } catch { return null; }
}

// ---------------------------------------------------------------- api

export class ApiError extends Error {
  constructor(status, payload) {
    super(`HTTP ${status}`);
    this.status = status;
    this.payload = payload || {};
  }
}

export async function api(path, { method = 'GET', body, idempotencyKey, token } = {}) {
  const headers = { };
  const t = token !== undefined ? token : getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(path, {
    method, headers, credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  const text = await res.text();
  if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

// ---------------------------------------------------------------- focus trap

/** Trap Tab inside an element while it is open, close on Escape, restore focus. */
export function useDialog(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const opener = document.activeElement;
    if (node) {
      const focusables = node.querySelectorAll('input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
      if (focusables.length) focusables[0].focus();
      else node.focus();
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'Tab' && node) {
        const items = Array.from(node.querySelectorAll('input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')).filter(el => !el.disabled);
        if (!items.length) return;
        const first = items[0]; const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!node.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open]);
  return ref;
}

/** Track clicks outside a node and Escape; used by header menus. */
export function useDismiss(open, onDismiss, ref) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref && ref.current && !ref.current.contains(e.target)) onDismiss();
    };
    const onKey = (e) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
}

// ---------------------------------------------------------------- toasts

let toastHost = null;

export function toast(message, kind = 'info') {
  if (typeof document === 'undefined') return;
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-region';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  toastHost.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// ---------------------------------------------------------------- icons

export function IconChevronDown({ size = 14 }) {
  return (<svg class="icon" width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" /></svg>);
}

export function IconChevronRight() {
  return (<svg class="icon" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 3l4 4-4 4" /></svg>);
}

export function IconMenu() {
  return (<svg class="icon icon-lg" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" /></svg>);
}

export function IconSearch() {
  return (<svg class="icon" viewBox="0 0 18 18" aria-hidden="true"><circle cx="7.5" cy="7.5" r="5" /><path d="M11.5 11.5L15 15" /></svg>);
}

export function IconCopy() {
  return (<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M13 4H5a1 1 0 0 0-1 1v8" /></svg>);
}

export function IconInfo() {
  return (<svg class="icon" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" /><path d="M9 8v4" /><circle cx="9" cy="5.6" r="0.7" fill="currentColor" stroke="none" /></svg>);
}

export function IconHome() {
  return (<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10l6-5.5 6 5.5M5.5 9v6h9V9" /></svg>);
}

export function IconPlus() {
  return (<svg class="icon" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.5v9M2.5 7h9" /></svg>);
}

export function IconCross() {
  return (<svg class="icon" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" /></svg>);
}

export function IconRefresh() {
  return (<svg class="icon" viewBox="0 0 18 18" aria-hidden="true"><path d="M15 9a6 6 0 1 1-1.8-4.3" /><path d="M15 2.5V6h-3.5" /></svg>);
}

export function IconTry() {
  return (<svg class="icon" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 16l1.2-3.6A7 7 0 1 1 5 15.4L2 16z" /></svg>);
}

// ---------------------------------------------------------------- shared components

export function Spinner({ dark }) {
  return (<span class={`spinner ${dark ? 'spinner-dark' : ''}`} aria-hidden="true" />);
}

export function Dialog({ title, onClose, children, closeLabel = 'Close' }) {
  const ref = useDialog(true, onClose);
  return (
    <div class="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <button type="button" class="dialog-close" onClick={onClose} aria-label={closeLabel}><IconCross /></button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function FieldError({ message }) {
  if (!message) return null;
  return <p class="error-text" role="alert">{message}</p>;
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return <div class="error-banner" role="alert">{message}</div>;
}
