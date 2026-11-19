import { asImage, chairSvg } from "../shared/dots.ts";
import { onFocusTaken } from "../shared/focusView.ts";

const GLIDE_MS = 320;
const STEP_MS = 160;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const RAIL_LINE_PX = 96;
const SCROLLED_PX = 24;
const BUSY = "Working…";
const REQUIRED = "This field is required.";
const NOT_EMAIL = "That is not an email address.";
const NOT_THE_PAIR = "That email and password do not match.";
const THANKS = "Thank you. Your enquiry is on its way.";
const PUBLIC_PATH = /^\/(?:work(?:\/[^/]+)?|enquire|sign-in|sign-up)?$/;

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
const main = (): HTMLElement => document.getElementById("main") as HTMLElement;
const pageKind = (): string | undefined => main().dataset.page;

function pathOf(url: string | URL = location.href): string {
  const parsed = new URL(url, location.href);
  return parsed.pathname + parsed.search;
}

/** Empties the region first, so the same message made twice is announced twice. */
function announce(text: string): void {
  const region = document.getElementById("announcements") as HTMLElement;
  region.textContent = "";
  setTimeout(() => {
    region.textContent = text;
  }, 40);
}

/* Header. */
const header = document.querySelector(".site-header") as HTMLElement;

function readScroll(): void {
  if (window.scrollY > SCROLLED_PX) header.dataset.scrolled = "true";
  else delete header.dataset.scrolled;
}

/* Work panel. */
const workButton = document.getElementById("work-button") as HTMLButtonElement;
const panel = document.getElementById("work-panel") as HTMLElement;
const preview = document.getElementById("work-preview") as HTMLElement;
let panelMotion: Animation | null = null;
let panelOpen = false;

function showPreview(tile: HTMLAnchorElement): void {
  const title = tile.textContent?.trim() ?? "";
  const name = `Preview of ${title}`;
  if (preview.getAttribute("aria-label") === name && preview.firstElementChild) return;
  preview.setAttribute("aria-label", name);
  panel.querySelectorAll("[data-showing]").forEach((other) => other.removeAttribute("data-showing"));
  tile.setAttribute("data-showing", "true");
  const layer = document.createElement("div");
  layer.innerHTML = asImage(chairSvg(tile.dataset.preview ?? ""));
  const earlier = [...preview.children];
  preview.append(layer);
  if (reduced() || earlier.length === 0) {
    earlier.forEach((old) => old.remove());
    return;
  }
  layer.animate({ opacity: [0, 1] }, { duration: STEP_MS, easing: EASE }).finished.then(
    () => earlier.forEach((old) => old.remove()),
    () => undefined,
  );
}

function finishPanel(): void {
  if (panelOpen) {
    panel.style.removeProperty("overflow");
    return;
  }
  panel.hidden = true;
  panel.inert = false;
  panel.style.removeProperty("overflow");
  delete header.dataset.open;
}

function openPanel(): void {
  panelOpen = true;
  panel.hidden = false;
  panel.inert = false;
  header.dataset.open = "true";
  workButton.setAttribute("aria-expanded", "true");
  showPreview(panel.querySelector<HTMLAnchorElement>("[data-preview]") as HTMLAnchorElement);
  if (reduced()) return;
  if (panelMotion?.playState === "running") {
    panelMotion.reverse();
    return;
  }
  panel.style.overflow = "hidden";
  panelMotion = panel.animate(
    [
      { height: "0px", opacity: 0 },
      { height: `${panel.getBoundingClientRect().height}px`, opacity: 1 },
    ],
    { duration: GLIDE_MS, easing: EASE },
  );
  panelMotion.onfinish = finishPanel;
}

/** Its tiles leave the Tab order at once; it leaves the tree when the closing motion ends. */
function closePanel(): void {
  if (!panelOpen) return;
  panelOpen = false;
  panel.inert = true;
  workButton.setAttribute("aria-expanded", "false");
  if (reduced() || !panelMotion) {
    panelMotion?.cancel();
    panelMotion = null;
    finishPanel();
    return;
  }
  panel.style.overflow = "hidden";
  panelMotion.reverse();
}

function closePanelAtOnce(): void {
  panelOpen = false;
  workButton.setAttribute("aria-expanded", "false");
  panelMotion?.cancel();
  panelMotion = null;
  finishPanel();
}

workButton.addEventListener("click", () => (panelOpen ? closePanel() : openPanel()));
workButton.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && panelOpen) {
    event.preventDefault();
    panel.querySelector<HTMLElement>("a")?.focus();
  }
});
panel.addEventListener("focusin", (event) => {
  const tile = (event.target as Element).closest<HTMLAnchorElement>("[data-preview]");
  if (tile) showPreview(tile);
});
panel.addEventListener("pointerover", (event) => {
  const tile = (event.target as Element).closest<HTMLAnchorElement>("[data-preview]");
  if (tile && event.pointerType === "mouse") showPreview(tile);
});
panel.addEventListener("focusout", (event) => {
  const next = event.relatedTarget as Node | null;
  if (panelOpen && next && next !== workButton && !panel.contains(next)) closePanel();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && panelOpen) {
    closePanel();
    workButton.focus();
  }
});
document.addEventListener("pointerdown", (event) => {
  const target = event.target as Node;
  if (panelOpen && !panel.contains(target) && !workButton.contains(target)) closePanel();
});

/* A mouse pointer's slight lift and control tone, read from the event. */
function hoverTarget(event: PointerEvent): Element | null {
  return event.pointerType === "mouse" ? (event.target as Element).closest?.(".button,.site-link,.case-tile,.panel-tile") ?? null : null;
}
document.addEventListener("pointerover", (event) => hoverTarget(event)?.setAttribute("data-hover", "true"));
document.addEventListener("pointerout", (event) => hoverTarget(event)?.removeAttribute("data-hover"));

/* Work filter: the same elements leave, enter and close up. */
function applyFilter(kind: string): void {
  const grid = document.getElementById("case-grid") as HTMLElement;
  const items = [...grid.querySelectorAll<HTMLElement>(".case-item")];
  const shown = (item: HTMLElement): boolean => kind === "" || item.dataset.kind === kind;
  const gridBox = grid.getBoundingClientRect();
  const before = new Map(items.filter((item) => !item.hidden).map((item) => [item, item.getBoundingClientRect()]));
  items.forEach((item) => {
    item.getAnimations().forEach((running) => running.cancel());
    item.removeAttribute("style");
    item.inert = false;
    item.hidden = !shown(item);
  });
  if (reduced()) return;
  const leaving = [...before.keys()].filter((item) => !shown(item));
  const staying = items.filter((item) => shown(item));
  const after = new Map(staying.map((item) => [item, item.getBoundingClientRect()]));
  for (const item of leaving) {
    const box = before.get(item) as DOMRect;
    item.hidden = false;
    item.inert = true;
    Object.assign(item.style, { position: "absolute", left: `${box.left - gridBox.left}px`, top: `${box.top - gridBox.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    item.animate({ opacity: [1, 0] }, { duration: GLIDE_MS, easing: EASE }).onfinish = () => {
      item.hidden = true;
      item.inert = false;
      item.removeAttribute("style");
    };
  }
  for (const item of staying) {
    const from = before.get(item);
    const to = after.get(item) as DOMRect;
    if (!from) item.animate({ opacity: [0, 1], transform: ["scale(0.96)", "none"] }, { duration: GLIDE_MS, easing: EASE });
    else if (from.left !== to.left || from.top !== to.top) {
      item.animate({ transform: [`translate(${from.left - to.left}px, ${from.top - to.top}px)`, "none"] }, { duration: GLIDE_MS, easing: EASE });
    }
  }
}

document.addEventListener("change", (event) => {
  const radio = event.target as HTMLInputElement;
  if (radio.name !== "kind" || pageKind() !== "work") return;
  go(radio.value ? `/work?kind=${radio.value}` : "/work");
  applyFilter(radio.value);
});

/* Case rail. */
interface Rail {
  frame: HTMLElement;
  marker: HTMLElement;
  links: HTMLAnchorElement[];
  headings: HTMLElement[];
  /** Set by a jump: the number stays current until the reader next scrolls. */
  heldAt: number | null;
}

let rail: Rail | null = null;
/** True while a direct address with a hash is still settling: the browser's own scroll is not the reader's. */
let landing = false;
const narrow = matchMedia("(max-width: 767.98px)");

function railRole(): void {
  if (!rail) return;
  if (narrow.matches) {
    rail.frame.setAttribute("role", "region");
    rail.frame.setAttribute("aria-label", "Section numbers");
    rail.frame.tabIndex = 0;
  } else {
    rail.frame.removeAttribute("role");
    rail.frame.removeAttribute("aria-label");
    rail.frame.removeAttribute("tabindex");
  }
}

function mark(index: number, glide: boolean): void {
  if (!rail) return;
  const link = rail.links[index] as HTMLAnchorElement;
  rail.links.forEach((other) => {
    if (other === link) other.setAttribute("aria-current", "true");
    else other.removeAttribute("aria-current");
  });
  if (glide && !reduced()) delete rail.marker.dataset.still;
  else rail.marker.dataset.still = "true";
  rail.marker.style.transform = narrow.matches ? `translateX(${link.offsetLeft}px)` : `translateY(${link.offsetTop}px)`;
  if (narrow.matches) {
    const frame = rail.frame.getBoundingClientRect();
    const box = link.getBoundingClientRect();
    if (box.left < frame.left || box.right > frame.right) {
      rail.frame.scrollTo({ left: rail.frame.scrollLeft + box.left - frame.left - (frame.width - box.width) / 2, behavior: "instant" });
    }
  }
}

function currentSection(found: Rail): number {
  const bottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
  if (bottom && window.scrollY > 0) return found.headings.length - 1;
  let current = 0;
  found.headings.forEach((heading, index) => {
    if (heading.getBoundingClientRect().top <= RAIL_LINE_PX) current = index;
  });
  return current;
}

function readRail(): void {
  if (!rail || landing) return;
  if (rail.heldAt !== null) {
    if (Math.abs(window.scrollY - rail.heldAt) < 1) return;
    rail.heldAt = null;
  }
  const current = currentSection(rail);
  if (rail.links[current]?.getAttribute("aria-current") !== "true") mark(current, true);
}

function coveredTop(): number {
  const bar = header.getBoundingClientRect().bottom;
  return narrow.matches && rail ? bar + rail.frame.getBoundingClientRect().height : bar;
}

/** Lands a section heading fully below the sticky parts, at once, focused and current. */
function jump(index: number): void {
  if (!rail) return;
  const heading = rail.headings[index] as HTMLElement;
  const top = heading.getBoundingClientRect().top + window.scrollY - coveredTop() - 12;
  window.scrollTo({ top, behavior: "instant" });
  rail.heldAt = window.scrollY;
  mark(index, false);
  heading.focus({ preventScroll: true });
}

function jumpToHash(): void {
  if (!rail || !location.hash) return;
  const index = rail.headings.findIndex((heading) => `#${heading.id}` === location.hash);
  if (index >= 0) jump(index);
}

function mountRail(): void {
  const frame = document.getElementById("rail-frame");
  if (!frame) {
    rail = null;
    return;
  }
  const links = [...frame.querySelectorAll<HTMLAnchorElement>("a")];
  rail = {
    frame,
    marker: frame.querySelector(".rail-marker") as HTMLElement,
    links,
    headings: links.map((link) => document.getElementById(link.hash.slice(1)) as HTMLElement),
    heldAt: null,
  };
  railRole();
  mark(currentSection(rail), false);
}

narrow.addEventListener("change", () => {
  railRole();
  readRail();
});

/* Forms. */
interface Refusal {
  field: HTMLInputElement | HTMLTextAreaElement;
  message: string;
}

function clearRefusals(form: HTMLFormElement): void {
  (form.querySelector(".problems-slot") as HTMLElement).replaceChildren();
  form.querySelectorAll<HTMLElement>("[aria-invalid]").forEach((field) => {
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
    const message = document.getElementById(`${field.id}-message`) as HTMLElement;
    message.hidden = true;
  });
}

function showRefusals(form: HTMLFormElement, refusals: readonly Refusal[]): void {
  const region = document.createElement("section");
  region.className = "problems";
  region.setAttribute("aria-label", "Problems");
  region.tabIndex = -1;
  const heading = document.createElement("h2");
  heading.textContent = "Problems";
  const list = document.createElement("ul");
  for (const { field, message } of refusals) {
    const line = document.getElementById(`${field.id}-message`) as HTMLElement;
    (line.lastElementChild as HTMLElement).textContent = message;
    line.hidden = false;
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", line.id);
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#${field.id}`;
    link.textContent = message;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      field.focus();
    });
    item.append(link);
    list.append(item);
  }
  region.append(heading, list);
  (form.querySelector(".problems-slot") as HTMLElement).replaceChildren(region);
  region.focus();
}

function fieldNamed(form: HTMLFormElement, name: string): HTMLInputElement | HTMLTextAreaElement | null {
  return form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
}

function localRefusals(form: HTMLFormElement): Refusal[] {
  const refusals: Refusal[] = [];
  form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-required]").forEach((field) => {
    if (field.value.trim() === "") refusals.push({ field, message: REQUIRED });
    else if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value.trim())) refusals.push({ field, message: NOT_EMAIL });
  });
  return refusals;
}

function setBusy(button: HTMLButtonElement, busy: boolean): void {
  if (busy) {
    button.dataset.name = button.textContent ?? "";
    button.style.minWidth = `${button.getBoundingClientRect().width}px`;
    button.textContent = BUSY;
    button.setAttribute("aria-disabled", "true");
  } else {
    button.textContent = button.dataset.name ?? "";
    button.removeAttribute("aria-disabled");
    button.style.removeProperty("min-width");
  }
}

const ENDPOINTS: Record<string, string> = { enquiry: "/api/enquiries", "sign-in": "/api/session", "sign-up": "/api/sign-up" };

async function submit(form: HTMLFormElement, button: HTMLButtonElement): Promise<void> {
  const kind = form.dataset.form as string;
  const body: Record<string, string> = Object.fromEntries([...new FormData(form).entries()].map(([name, value]) => [name, String(value)]));
  const returnTo = new URLSearchParams(location.search).get("returnTo");
  if (kind === "sign-in" && returnTo !== null) body.returnTo = returnTo;
  setBusy(button, true);
  let response: Response;
  try {
    response = await fetch(ENDPOINTS[kind] as string, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    setBusy(button, false);
    announce("That could not be sent. Try again.");
    return;
  }
  const answer = (await response.json().catch(() => ({}))) as { session?: { landing: string }; error?: { message: string; fields?: Record<string, string> } };
  if (response.ok) {
    if (answer.session) {
      location.assign(answer.session.landing);
      return;
    }
    setBusy(button, false);
    form.reset();
    announce(THANKS);
    return;
  }
  setBusy(button, false);
  const message = answer.error?.message ?? "";
  announce(message);
  const refusals = Object.entries(answer.error?.fields ?? {}).flatMap(([name, text]) => {
    const field = fieldNamed(form, name);
    return field ? [{ field, message: text }] : [];
  });
  if (message === NOT_THE_PAIR) refusals.push({ field: fieldNamed(form, "password") as HTMLInputElement, message });
  if (refusals.length > 0) showRefusals(form, refusals);
}

document.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.dataset.form) return;
  event.preventDefault();
  const button = form.querySelector("button[type=submit]") as HTMLButtonElement;
  if (button.getAttribute("aria-disabled") === "true") return;
  clearRefusals(form);
  const refusals = localRefusals(form);
  if (refusals.length > 0) {
    announce((refusals[0] as Refusal).message);
    showRefusals(form, refusals);
    return;
  }
  void submit(form, button);
});

/* Moving between screens. */
interface Move {
  drawing: HTMLElement;
  home: Comment;
  motion: Animation | null;
  incoming: HTMLElement | null;
}

let visit = 0;
let move: Move | null = null;
/** The path the history holds, and the path whose page is on screen; they differ only while a page is arriving. */
let addressPath = location.pathname;
let shownPath = location.pathname;

function rememberScroll(): void {
  history.replaceState({ ...(history.state as object | null), scroll: window.scrollY }, "");
}

function go(address: string): void {
  rememberScroll();
  history.pushState(null, "", address);
  addressPath = location.pathname;
}

function mountPage(): void {
  mountRail();
  if (pageKind() === "access") (document.querySelector("h1") as HTMLElement).focus();
}

function focusHeading(): void {
  (main().querySelector("h1") as HTMLElement).focus({ preventScroll: true });
}

async function readPage(path: string): Promise<Document | null> {
  const response = await fetch(path, { headers: { Accept: "text/html" } });
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return null;
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

function adopt(next: Document): void {
  document.title = next.title;
  main().replaceWith(document.adoptNode(next.getElementById("main") as HTMLElement));
  const footer = document.querySelector(".site-footer");
  const nextFooter = next.querySelector(".site-footer");
  if (footer && !nextFooter) footer.remove();
  if (!footer && nextFooter) main().after(document.adoptNode(nextFooter));
}

/** Shows the address the history now holds. */
async function show(after: (visitNumber: number) => void): Promise<void> {
  const mine = (visit += 1);
  const target = location.href;
  const next = await readPage(pathOf()).catch(() => null);
  if (mine !== visit) return;
  if (!next) {
    location.assign(target);
    return;
  }
  adopt(next);
  shownPath = location.pathname;
  mountPage();
  after(mine);
}

function follow(link: HTMLAnchorElement): void {
  const address = new URL(link.href);
  closePanelAtOnce();
  go(address.pathname + address.search + address.hash);
  void show(() => {
    if (address.hash && rail) {
      jumpToHash();
      return;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    if (pageKind() === "access") return;
    focusHeading();
  });
}

function undoMove(): void {
  if (!move) return;
  const { drawing, home, motion, incoming } = move;
  if (motion) motion.onfinish = null;
  motion?.cancel();
  incoming?.remove();
  drawing.removeAttribute("data-moving");
  drawing.removeAttribute("data-hero");
  drawing.removeAttribute("style");
  home.replaceWith(drawing);
  main().inert = false;
  move = null;
}

function landMove(next: Document, mine: number): void {
  if (!move || mine !== visit) return;
  const { drawing, home, incoming } = move;
  const slot = (incoming as HTMLElement).querySelector("[data-hero-slot]") as HTMLElement;
  document.title = next.title;
  drawing.removeAttribute("data-moving");
  drawing.removeAttribute("style");
  drawing.setAttribute("role", "img");
  drawing.setAttribute("aria-label", slot.dataset.heroLabel ?? "");
  slot.replaceWith(drawing);
  home.remove();
  const arriving = incoming as HTMLElement;
  arriving.classList.remove("page-incoming");
  arriving.removeAttribute("style");
  main().remove();
  arriving.id = "main";
  shownPath = location.pathname;
  move = null;
  window.scrollTo({ top: 0, behavior: "instant" });
  mountPage();
  focusHeading();
}

/** Pressing a case: the tile's drawing element itself travels to the hero, one element, one 320 ms motion. */
function moveToCase(link: HTMLAnchorElement): void {
  const drawing = link.querySelector<HTMLElement>('[data-part="case-drawing"]') as HTMLElement;
  go(new URL(link.href).pathname);
  main().inert = true;
  const mine = (visit += 1);
  const home = document.createComment("drawing");
  move = { drawing, home, motion: null, incoming: null };
  void readPage(pathOf())
    .catch(() => null)
    .then((next) => {
      if (mine !== visit || !move) return;
      if (!next) {
        location.reload();
        return;
      }
      const arriving = document.adoptNode(next.getElementById("main") as HTMLElement);
      arriving.removeAttribute("id");
      arriving.classList.add("page-incoming");
      const slot = arriving.querySelector('[data-part="case-drawing"]') as HTMLElement;
      slot.dataset.heroSlot = "true";
      slot.dataset.heroLabel = slot.getAttribute("aria-label") ?? "";
      slot.removeAttribute("data-part");
      slot.removeAttribute("data-case");
      slot.removeAttribute("data-hero");
      slot.removeAttribute("role");
      slot.removeAttribute("aria-label");
      slot.replaceChildren();
      const top = main().getBoundingClientRect().top + window.scrollY;
      arriving.style.top = `${top}px`;
      main().after(arriving);
      const to = slot.getBoundingClientRect();
      const toTop = to.top + window.scrollY;
      const from = drawing.getBoundingClientRect();
      move.incoming = arriving;
      drawing.replaceWith(home);
      document.body.append(drawing);
      drawing.dataset.moving = "true";
      drawing.dataset.hero = "true";
      Object.assign(drawing.style, { left: `${to.left}px`, top: `${toTop}px`, width: `${to.width}px`, height: `${to.height}px` });
      const motion = drawing.animate(
        { transform: [`translate(${from.left - to.left}px, ${from.top - toTop}px) scale(${from.width / to.width})`, "none"] },
        { duration: GLIDE_MS, easing: EASE },
      );
      move.motion = motion;
      motion.onfinish = () => landMove(next, mine);
    });
}

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest?.<HTMLAnchorElement>("a[href]");
  if (!link) return;
  if (rail?.links.includes(link)) {
    event.preventDefault();
    const index = rail.links.indexOf(link);
    go(link.hash);
    jump(index);
    return;
  }
  const address = new URL(link.href);
  if (address.origin !== location.origin || !PUBLIC_PATH.test(address.pathname)) return;
  event.preventDefault();
  if (move) return;
  if (link.dataset.caseLink && !reduced()) moveToCase(link);
  else follow(link);
});

window.addEventListener("popstate", (event) => {
  const left = addressPath;
  addressPath = location.pathname;
  undoMove();
  const scroll = (event.state as { scroll?: number } | null)?.scroll ?? 0;
  const justLeft = (): HTMLElement | null => main().querySelector<HTMLElement>(`[data-case-link="${left.split("/").pop()}"]`);
  if (shownPath === location.pathname) {
    visit += 1;
    if (pageKind() === "work") {
      const kind = new URLSearchParams(location.search).get("kind") ?? "";
      document.querySelectorAll<HTMLInputElement>('input[name="kind"]').forEach((radio) => {
        radio.checked = radio.value === kind;
      });
      applyFilter(kind);
      justLeft()?.focus({ preventScroll: true });
    } else if (location.hash) jumpToHash();
    else window.scrollTo({ top: scroll, behavior: "instant" });
    return;
  }
  void show(() => {
    window.scrollTo({ top: scroll, behavior: "instant" });
    const tile = justLeft();
    if (tile && !tile.closest("[hidden]")) tile.focus({ preventScroll: true });
    else if (location.hash && rail) jumpToHash();
    else focusHeading();
  });
});

/* Sticky parts never cover a control that takes focus. */
onFocusTaken((target) => {
  if (target.closest(".site-header,.rail-frame") || target.matches("h1,h2")) return;
  const box = target.getBoundingClientRect();
  const limit = coveredTop() + 8;
  if (box.top < limit) window.scrollBy({ top: box.top - limit, behavior: "instant" });
});

window.addEventListener("pagehide", rememberScroll);
window.addEventListener(
  "scroll",
  () => {
    readScroll();
    readRail();
  },
  { passive: true },
);

history.scrollRestoration = "manual";
mountPage();
const arrivedAt = (history.state as { scroll?: number } | null)?.scroll;
if (location.hash) {
  landing = true;
  jumpToHash();
  const loaded = new Promise((done) => (document.readyState === "complete" ? done(null) : window.addEventListener("load", done, { once: true })));
  void Promise.all([loaded, document.fonts.ready]).then(() => {
    landing = false;
    jumpToHash();
  });
} else if (arrivedAt) window.scrollTo({ top: arrivedAt, behavior: "instant" });
readScroll();
readRail();

