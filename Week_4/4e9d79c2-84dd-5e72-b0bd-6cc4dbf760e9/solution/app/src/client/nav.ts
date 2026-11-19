// Desk moves: one wipe between screens, in-place reads for filters and paging, and Back to the same place.
import { $, announce, EASE, reducedMotion } from "./core.js";
import { closeAll } from "./dialogs.js";
import { cancelRefreshes, holdRefresh, notifyScreenChanged, readPage, releaseRefresh, sessionEnded, type PageRead } from "./refresh.js";
import { morphPage } from "./morph.js";

let softSequence = 0;
const swapIn = (parsed: Document): void => {
  document.title = parsed.title;
  const replace = (id: string): void => {
    const next = parsed.getElementById(id);
    const current = document.getElementById(id);
    if (next && current) current.replaceChildren(...[...next.childNodes].map((n) => document.importNode(n, true)));
  };
  replace("app");
  replace("overlays");
};
const rememberPlace = (rowHref: string | null): void => {
  history.replaceState({ ...(history.state ?? {}), y: scrollY, row: rowHref }, "");
};

/** Reads an address and changes the screen in place, keeping focus. The newest read wins. */
export const softNavigate = async (url: string, how: "push" | "replace" | "none" = "push"): Promise<void> => {
  const mine = (softSequence += 1);
  cancelRefreshes();
  if (how === "push") history.pushState({}, "", url);
  if (how === "replace") history.replaceState({}, "", url);
  try {
    const read = await readPage(url);
    if (mine !== softSequence) return;
    if (read.ended) return sessionEnded();
    if (read.parsed) {
      morphPage(read.parsed);
      notifyScreenChanged();
    }
  } catch {
    if (mine === softSequence) announce("Couldn't refresh. Trying again.", false);
  }
};

const WIPE_MS = 320;
const playWipe = async (url: string, place: { y?: number; row?: string | null } | null): Promise<void> => {
  const app = document.getElementById("app") as HTMLElement;
  cancelRefreshes();
  holdRefresh();
  closeAll();
  app.inert = true;
  app.dataset.wiping = "1";
  const reading: Promise<PageRead> = readPage(url);
  let read: PageRead | null = null;
  void reading.then((r) => { read = r; }, () => { read = { status: 0, ended: false, parsed: null }; });
  const finish = (): void => {
    const done = read as PageRead | null;
    if (done?.parsed) {
      swapIn(done.parsed);
      notifyScreenChanged();
    }
    const fresh = document.getElementById("app") as HTMLElement;
    fresh.inert = false;
    delete fresh.dataset.wiping;
    scrollTo({ top: place?.y ?? 0, behavior: "instant" });
    const row = place?.row ? $<HTMLElement>(`a[href="${CSS.escape(place.row)}"]`) : null;
    (row ?? $<HTMLElement>("h1"))?.focus({ preventScroll: Boolean(place) });
    releaseRefresh();
    if (done?.ended) sessionEnded();
  };
  if (reducedMotion()) {
    await reading.catch(() => undefined);
    return finish();
  }
  const wipe = document.createElement("div");
  wipe.className = "page-wipe";
  wipe.dataset.part = "page-wipe";
  wipe.setAttribute("aria-hidden", "true");
  document.body.append(wipe);
  const motion = wipe.animate([{ transform: "translateX(-100%)", easing: EASE }, { transform: "translateX(0)", offset: 0.5, easing: EASE }, { transform: "translateX(100%)" }], { duration: WIPE_MS, fill: "both" });
  const swapMiddle = async (): Promise<void> => {
    while ((motion.currentTime as number ?? 0) < WIPE_MS / 2 && motion.playState === "running") await new Promise(requestAnimationFrame);
    if (!read) {
      motion.pause();
      await reading.catch(() => undefined);
      motion.play();
    }
    const done = read as PageRead | null;
    if (done?.parsed) {
      swapIn(done.parsed);
      notifyScreenChanged();
      (document.getElementById("app") as HTMLElement).inert = true;
      read = { ...done, parsed: null };
      scrollTo({ top: place?.y ?? 0, behavior: "instant" });
    }
  };
  await swapMiddle();
  await motion.finished.catch(() => undefined);
  wipe.remove();
  finish();
};

export const initNavigation = (): void => {
  if (!["desk"].includes(document.documentElement.dataset.kind ?? "")) return;
  history.scrollRestoration = "manual";
  document.addEventListener("click", (event) => {
    const mouse = event as MouseEvent;
    if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.button !== 0) return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-nav],a[data-soft]");
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("href") as string;
    if (link.hasAttribute("data-soft")) return void softNavigate(href);
    rememberPlace(href);
    history.pushState({}, "", href);
    void playWipe(href, null);
  });
  let path = location.pathname;
  window.addEventListener("popstate", () => {
    const url = location.pathname + location.search;
    if (location.pathname === path) {
      void softNavigate(url, "none");
    } else {
      void playWipe(url, history.state);
    }
    path = location.pathname;
  });
  const original = history.pushState.bind(history);
  history.pushState = (...args: Parameters<typeof history.pushState>) => {
    original(...args);
    path = location.pathname;
  };
};
