// SR1: signed-in screens and private pages read themselves again every 5 seconds.
import { $, $$, announce, announceRefreshFailure, liveScreen } from "./core.js";
import { closeAll, topDialog } from "./dialogs.js";
import { morphPage } from "./morph.js";

const REFRESH_MS = 5000;
let sequence = 0;
let holds = 0;
const listeners: (() => void)[] = [];
export const afterRefresh = (listener: () => void): void => { listeners.push(listener); };
export const notifyScreenChanged = (): void => { for (const listener of listeners) listener(); };
/** Drags and page wipes hold refreshes back so nothing moves under a pointer. */
export const holdRefresh = (): void => { holds += 1; };
export const releaseRefresh = (): void => { holds = Math.max(holds - 1, 0); };

export interface PageRead { status: number; ended: boolean; parsed: Document | null }
export const readPage = async (url: string): Promise<PageRead> => {
  const response = await fetch(url, { redirect: "manual", headers: { Accept: "text/html" } });
  if (response.type === "opaqueredirect" || response.status === 303) return { status: 303, ended: true, parsed: null };
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return { status: response.status, ended: false, parsed: null };
  return { status: response.status, ended: false, parsed: new DOMParser().parseFromString(await response.text(), "text/html") };
};

const refreshLines = (): HTMLElement[] => $$('[data-part="refresh-line"]');
const showFailed = (): void => {
  const lines = refreshLines();
  for (const line of lines) line.hidden = false;
  announceRefreshFailure(lines[0]?.textContent ?? "Couldn't refresh. Trying again.");
};
const clearFailed = (): void => {
  for (const line of refreshLines()) line.hidden = true;
  announceRefreshFailure("");
};

const ENDED_COPY = "Your session ended. Sign in again to keep going — what you typed is still here.";
const returnAddress = (): string => `/sign-in?return=${encodeURIComponent(location.pathname + location.search)}`;
let endedShown = false;
/** The server ended the session: everything stays as typed and the line offers the way back. */
export const sessionEnded = (): void => {
  const line = $<HTMLElement>("[data-ended]");
  if (!line) return;
  const link = $<HTMLAnchorElement>("[data-sign-in-again]", line);
  if (link) link.href = returnAddress();
  const dialog = topDialog();
  if (dialog) {
    const inside = line.cloneNode(true) as HTMLElement;
    inside.hidden = false;
    inside.classList.add("ended-inside");
    if (!$("[data-ended]", dialog)) dialog.querySelector(".dialog-head")?.after(inside);
  } else line.hidden = false;
  if (!endedShown) announce(ENDED_COPY, false);
  endedShown = true;
};

/** Keeps what was typed for after signing in again. */
const saveDraft = (): void => {
  const dialog = topDialog();
  const fields: Record<string, string> = {};
  for (const field of $$<HTMLInputElement>("input,select,textarea", dialog ?? document.getElementById("screen") ?? document)) {
    if (field.name && field.type !== "file" && field.type !== "password" && field.dataset.dirty) fields[field.name] = field.value;
  }
  sessionStorage.setItem(`draft:${location.pathname}${location.search}`, JSON.stringify({ dialog: dialog?.id ?? null, fields }));
};
export const restoreDraft = (): void => {
  const key = `draft:${location.pathname}${location.search}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return;
  sessionStorage.removeItem(key);
  const draft = JSON.parse(raw) as { dialog: string | null; fields: Record<string, string> };
  const opener = draft.dialog ? $<HTMLElement>(`[data-dialog-open="${CSS.escape(draft.dialog)}"]`) : null;
  opener?.click();
  const root = (draft.dialog ? document.getElementById(draft.dialog) : document.getElementById("screen")) as ParentNode;
  for (const [name, value] of Object.entries(draft.fields)) {
    const field = root.querySelector<HTMLInputElement>(`[name="${CSS.escape(name)}"]`);
    if (field) { field.value = value; field.dataset.dirty = "1"; }
  }
};

/** A private page whose address has ended changes in place to its ended heading, with focus on that heading. */
const endInPlace = (parsed: Document): void => {
  closeAll();
  document.documentElement.lang = parsed.documentElement.lang;
  document.documentElement.dir = parsed.documentElement.dir;
  delete document.documentElement.dataset.live;
  document.title = parsed.title;
  document.getElementById("app")?.replaceChildren(...[...(parsed.getElementById("app") as HTMLElement).childNodes].map((n) => document.importNode(n, true)));
  document.getElementById("app")!.inert = false;
  $<HTMLElement>("h1")?.focus();
};

export const refreshNow = async (): Promise<void> => {
  if (!liveScreen()) return;
  const mine = (sequence += 1);
  if (navigator.onLine === false) {
    showFailed();
    notifyScreenChanged();
    return;
  }
  try {
    const read = await readPage(location.pathname + location.search);
    if (mine !== sequence) return;
    if (read.ended) return sessionEnded();
    if (read.status === 410 && read.parsed) return endInPlace(read.parsed);
    if (read.status >= 400 || !read.parsed) return showFailed();
    if (holds > 0) return;
    morphPage(read.parsed);
    clearFailed();
    notifyScreenChanged();
  } catch {
    if (mine === sequence) {
      showFailed();
      notifyScreenChanged();
    }
  }
};
export const cancelRefreshes = (): void => { sequence += 1; };
export const startRefreshing = (): void => {
  setInterval(() => { if (holds === 0 && !document.getElementById("app")?.dataset.wiping) void refreshNow(); }, REFRESH_MS);
  document.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-sign-in-again]")) saveDraft();
  }, true);
};
