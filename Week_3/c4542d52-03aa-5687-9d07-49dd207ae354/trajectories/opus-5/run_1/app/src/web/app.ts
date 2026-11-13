import type { LiveEvent, Person, Role, Tender } from "../shared/types.js";
import { formatCount, formatCountdown, formatInstant, formatMoney } from "../shared/format.js";
import { api, ApiFailure } from "./api.js";
import { clear, el } from "./dom.js";
import { closeLive, connectLive, isSocketOpen, onLiveEvent, onSocketState } from "./live.js";
import { ROLE_LABELS } from "./labels.js";

export interface PageContext {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  main: HTMLElement;
}

export interface Page {
  render(): Promise<void>;
  onEvent?(event: LiveEvent): void;
  destroy?(): void;
}

export type PageFactory = (context: PageContext) => Page;

interface RouteEntry {
  segments: string[];
  roles: Role[] | "all";
  factory: PageFactory;
}

const routes: RouteEntry[] = [];
let currentPage: Page | null = null;
let currentPerson: Person | null = null;
let shell: HTMLElement;
let main: HTMLElement;
let navigation: HTMLElement | null = null;

export function registerRoute(path: string, roles: Role[] | "all", factory: PageFactory): void {
  routes.push({ segments: path.split("/").filter((part) => part !== ""), roles, factory });
}

export function person(): Person | null {
  return currentPerson;
}

export function setPerson(value: Person | null): void {
  currentPerson = value;
}

export function announce(message: string): void {
  const region = document.getElementById("status-region");
  if (region === null) return;
  region.replaceChildren(el("p", {}, [message]));
}

const announcedKeys = new Set<string>();

/** Each timed or decided event is announced once per page. */
export function announceOnce(key: string, message: string): void {
  if (announcedKeys.has(key)) return;
  announcedKeys.add(key);
  announce(message);
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace === true) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  void renderRoute();
}

export function replaceAddress(path: string): void {
  window.history.replaceState(null, "", path);
}

function matchRoute(path: string): { entry: RouteEntry; params: Record<string, string> } | null {
  const segments = path.split("/").filter((part) => part !== "");
  for (const entry of routes) {
    if (entry.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (let index = 0; index < segments.length; index += 1) {
      const expected = entry.segments[index] ?? "";
      const actual = segments[index] ?? "";
      if (expected.startsWith(":")) params[expected.slice(1)] = actual;
      else if (expected !== actual) {
        matches = false;
        break;
      }
    }
    if (matches) return { entry, params };
  }
  return null;
}

const NAV_LINKS: Record<Role, Array<[string, string]>> = {
  option_holder: [
    ["Portal", "/"],
    ["Vesting", "/vesting"],
    ["Exercise", "/exercise"],
    ["Documents", "/documents"],
    ["Cap table", "/cap-table"],
  ],
  leaver: [
    ["Portal", "/"],
    ["Vesting", "/vesting"],
    ["Exercise", "/exercise"],
    ["Documents", "/documents"],
    ["Cap table", "/cap-table"],
  ],
  investor: [
    ["Portal", "/"],
    ["Tender", "/tenders"],
    ["Documents", "/documents"],
    ["Cap table", "/cap-table"],
  ],
  board_member: [
    ["Portal", "/"],
    ["Board queue", "/board"],
    ["Cap table", "/cap-table"],
  ],
  founder_admin: [
    ["Portal", "/"],
    ["Cap table", "/cap-table"],
    ["Ledger", "/admin/ledger"],
    ["Grants", "/admin/grants"],
    ["Valuations", "/admin/valuations"],
    ["Tenders", "/admin/tenders"],
    ["Round scenario", "/admin/scenario"],
    ["People", "/admin/people"],
    ["Documents", "/documents"],
  ],
};

function buildShell(): void {
  clear(shell);
  if (currentPerson === null) {
    navigation = null;
    main = el("main", { id: "main" });
    shell.append(main);
    return;
  }
  const links = NAV_LINKS[currentPerson.role].map(([label, path]) =>
    el("a", { href: path, class: "nav-link", "data-route": "" }, [label]),
  );
  const signOut = el("button", { type: "button", class: "sign-out" }, ["Sign out"]);
  signOut.addEventListener("click", () => void signOutNow());
  navigation = el("nav", { "aria-label": "Register", class: "register-nav" }, [
    el("div", { class: "nav-links" }, links),
    signOut,
  ]);
  main = el("main", { id: "main" });
  shell.append(navigation, main);
}

async function signOutNow(): Promise<void> {
  await api("/api/session", { method: "DELETE" }).catch(() => undefined);
  closeLive();
  currentPerson = null;
  navigate("/");
}

export function applySocketState(): void {
  const open = isSocketOpen();
  for (const node of document.querySelectorAll<HTMLButtonElement>("button.live-action")) {
    node.disabled = !open || node.dataset["blocked"] === "true";
  }
  for (const node of document.querySelectorAll<HTMLSelectElement>("select.live-action")) node.disabled = !open;
  const strip = document.getElementById("socket-strip");
  if (strip !== null) strip.hidden = open || currentPerson === null;
}

export function notFoundPage(context: PageContext): Page {
  return {
    async render(): Promise<void> {
      clear(context.main);
      context.main.append(
        el("section", { class: "band band-ink full" }, [
          el("h1", {}, ["Not on your register"]),
          el("p", {}, ["This record isn't on your register."]),
        ]),
      );
    },
  };
}

export function loadingBand(main: HTMLElement): void {
  clear(main);
  main.append(el("section", { class: "band band-ink full" }, [el("p", {}, ["Loading your register."])]));
}

export function errorBand(main: HTMLElement, message: string): void {
  clear(main);
  main.append(el("section", { class: "band band-ink full" }, [el("p", {}, [message])]));
}

export async function renderRoute(): Promise<void> {
  const path = window.location.pathname;
  if (currentPage?.destroy !== undefined) currentPage.destroy();
  currentPage = null;
  buildShell();
  const match = matchRoute(path);
  const context: PageContext = {
    path,
    params: match === null ? {} : match.params,
    query: new URLSearchParams(window.location.search),
    main,
  };
  if (match === null) {
    currentPage = notFoundPage(context);
  } else if (
    match.entry.roles !== "all" &&
    (currentPerson === null || !match.entry.roles.includes(currentPerson.role))
  ) {
    currentPage = notFoundPage(context);
  } else {
    currentPage = match.entry.factory(context);
  }
  loadingBand(main);
  try {
    await currentPage.render();
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) {
      currentPerson = null;
      buildShell();
      await renderRoute();
      return;
    }
    if (error instanceof ApiFailure && (error.status === 404 || error.status === 403)) {
      currentPage = notFoundPage(context);
      await currentPage.render();
    } else {
      errorBand(main, "Something went wrong on our side. Your register has not changed.");
    }
  }
  applySocketState();
}

/** The timed and decided events, announced once each wherever the person has a page open. */
function announceEvent(event: LiveEvent): void {
  const data = event.data;
  const grantId = typeof data["grant_id"] === "string" ? data["grant_id"] : "";
  const key = `event-${event.seq}`;
  if (event.type === "offer_warning" && typeof data["offer_expires_at"] === "string") {
    announceOnce(key, `The offer for grant ${grantId} lapses at ${formatInstant(data["offer_expires_at"])}. Accept or decline before then.`);
    return;
  }
  if (event.type === "window_warning" && typeof data["warning_seconds"] === "number") {
    announceOnce(key, `Your exercise window on grant ${grantId} closes in ${formatCountdown(data["warning_seconds"] * 1000)}.`);
    return;
  }
  if (event.type === "tranche_vested" && typeof data["options_vested"] === "number") {
    announceOnce(key, `${formatCount(data["options_vested"])} options vested today on grant ${grantId}.`);
    return;
  }
  if (event.type === "window_closed" && typeof data["cancelled"] === "number") {
    announceOnce(
      key,
      `Your exercise window has closed. ${formatCount(data["cancelled"])} unexercised options on grant ${grantId} were cancelled.`,
    );
    return;
  }
  if (event.type === "grant_changed") {
    const reason = data["reason"];
    if (reason === "expired") announceOnce(key, `The offer for grant ${grantId} has expired.`);
    else if (reason === "approved") announceOnce(key, `Grant ${grantId} approved by the board.`);
    else if (reason === "returned_to_draft") announceOnce(key, `Grant ${grantId} returned to draft by the board.`);
    else if (reason === "offered" && currentPerson !== null && data["holder_id"] === currentPerson.id) {
      const options = typeof data["options"] === "number" ? formatCount(data["options"]) : "";
      announceOnce(key, `A grant offer is waiting: ${grantId}, ${options} options.`);
    }
    return;
  }
  if (event.type === "order_changed") {
    const reason = data["reason"];
    const orderId = typeof data["order_id"] === "string" ? data["order_id"] : "";
    if (reason === "issued" && typeof data["options"] === "number") {
      announceOnce(key, `Payment confirmed. ${formatCount(data["options"])} shares issued on grant ${grantId}.`);
    } else if (reason === "notice_sealed") {
      announceOnce(key, `Exercise notice for ${orderId} sealed in the vault.`);
    }
    return;
  }
  if (event.type === "tender_closed" && typeof data["tender_id"] === "string") {
    announceOnce(key, `Tender ${data["tender_id"]} has closed.`);
    return;
  }
  if (event.type === "tender_allocated" && typeof data["tender_id"] === "string") {
    const tenderId = data["tender_id"];
    if (currentPerson === null || currentPerson.role !== "investor") return;
    void api<Tender>(`/api/tenders/${tenderId}`).then((tender) => {
      const mine = tender.mine;
      if (mine === undefined || mine.allocation === null || mine.proceeds === null) return;
      announceOnce(
        key,
        `Tender ${tenderId} allocated: you sold ${formatCount(mine.allocation)} shares for ${formatMoney(mine.proceeds)}.`,
      );
    });
  }
}

function handleGlobalEvent(event: LiveEvent): void {
  announceEvent(event);
  if (event.type === "role_changed" && currentPerson !== null && event.data["person_id"] === currentPerson.id) {
    const role = event.data["role"];
    if (typeof role !== "string") return;
    void (async () => {
      const closers = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
      for (const dialog of closers) dialog.close();
      const result = await api<{ person: Person }>("/api/me");
      currentPerson = result.person;
      announce(`Your role is now ${ROLE_LABELS[result.person.role]}.`);
      navigate("/");
      window.setTimeout(() => {
        const nameHeading = document.querySelector<HTMLElement>(".name-tile h1");
        if (nameHeading !== null) {
          nameHeading.tabIndex = -1;
          nameHeading.focus();
        }
      }, 50);
    })();
    return;
  }
  if (event.type === "access_removed" && currentPerson !== null && event.data["person_id"] === currentPerson.id) {
    closeLive();
    for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) dialog.close();
    currentPerson = null;
    clear(shell);
    main = el("main", { id: "main" });
    shell.append(main);
    clear(main);
    main.append(
      el("section", { class: "band band-ink full" }, [
        el("p", {}, ["Your access to the Tidecraft register has ended."]),
        el("a", { href: "/", class: "band-link" }, ["Sign in"]),
      ]),
    );
    announce("Your access to the Tidecraft register has ended.");
    return;
  }
  if (currentPage?.onEvent !== undefined) currentPage.onEvent(event);
}

export function startApp(): void {
  const root = document.getElementById("shell");
  if (root === null) throw new Error("the shell is missing");
  shell = root;
  main = el("main", { id: "main" });
  shell.append(main);

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("a[data-route]");
    if (link === null || !(link instanceof HTMLAnchorElement)) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(link.getAttribute("href") ?? "/");
  });
  window.addEventListener("popstate", () => void renderRoute());
  onLiveEvent(handleGlobalEvent);
  onSocketState(() => applySocketState());

  void (async () => {
    try {
      const result = await api<{ person: Person }>("/api/me");
      currentPerson = result.person;
      connectLive();
    } catch {
      currentPerson = null;
    }
    await renderRoute();
  })();
}

export function startLiveSocket(): void {
  connectLive();
}

export function signedInAs(): Person {
  if (currentPerson === null) throw new Error("no one is signed in");
  return currentPerson;
}
