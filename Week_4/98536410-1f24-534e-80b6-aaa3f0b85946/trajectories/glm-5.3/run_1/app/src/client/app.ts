// Tramela Estate client: routing, header, storage notice, and page mounting.
import { Api, ApiFailure, StaleAnswer, reducedMotion, el, clear, historyParams } from "./core.js";
import { mountEstate } from "./estate.js";
import { mountBackOffice } from "./backoffice.js";
import { mountCareSearch, mountCareOrder } from "./care.js";
import { mountCatalogue, mountProduct, mountCart, mountOrder } from "./storefront.js";

export interface StoreDisplay {
  id: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  display_state: string;
  state_label: string;
  suspended: boolean;
  suspension_reason: string | null;
  closes_local: string | null;
  critical_lines: number;
}

export interface MeAnswer {
  user: { id: string; name: string; email: string; role: "lead" | "manager" | "care" | "shopper"; operator_id: string };
  operator: { id: string; name: string };
  store_ids: string[];
  session_expires_at: string;
}

export interface AppContext {
  api: Api;
  me: MeAnswer;
  role: string;
  root: HTMLElement;
  statusStorage: StorageStatusView;
  onUnauthenticated: () => void;
}

export interface StorageStatusView {
  setDown(): void;
  setUp(): void;
  isDown(): boolean;
  start(): void;
  stop(): void;
}

const ROLE_PAGES: Record<string, RegExp> = {
  lead: /^\/estate$/,
  manager: /^\/shop\/[^/]+$/,
  care: /^\/care(\/orders\/[^/]+)?$/,
  shopper: /^\/(catalogue|products\/[^/]+|cart|orders\/[^/]+)$/,
};

let activeCleanup: (() => void) | null = null;
let pendingNav: string | null = null;

export function navigate(path: string): void {
  pendingNav = path;
  window.history.pushState({}, "", path);
  void render();
}

export function navigateReplace(path: string): void {
  pendingNav = path;
  window.history.replaceState({}, "", path);
  void render();
}

export async function render(): Promise<void> {
  const api = new Api(handleUnauthenticated);
  const path = window.location.pathname;
  const root = getRoot();
  const headerSlot = document.getElementById("site-header") as HTMLElement;

  // Stop previous page's timers.
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }

  const header = buildSignedOutHeader();
  clear(headerSlot);
  headerSlot.appendChild(header);
  hideStorageBand();

  const session = await loadSession(api);

  if (path === "/" || path === "/index.html") {
    mountLanding(root, api);
    return;
  }
  if (path === "/sign-in") {
    mountSignIn(root, api);
    return;
  }

  if (!session) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    navigateReplace(`/sign-in?next=${next}`);
    return;
  }

  api.nextGeneration();
  const ctx: AppContext = {
    api,
    me: session,
    role: session.user.role,
    root,
    statusStorage: createStorageMonitor(api),
    onUnauthenticated: () => handleUnauthenticatedFor(session.user.id),
  };

  clear(headerSlot);
  headerSlot.appendChild(buildSignedInHeader(ctx));
  ctx.statusStorage.start();

  const rolePattern = ROLE_PAGES[session.user.role];
  if (!rolePattern || !rolePattern.test(path)) {
    mountNotFound(root);
    return;
  }

  const mod = await pageModule(path, session.user.role);
  if (mod) {
    activeCleanup = mod(ctx) ?? null;
  }
}

async function pageModule(path: string, role: string): Promise<((ctx: AppContext) => (() => void) | null) | null> {
  if (role === "lead") {
    return mountEstate;
  }
  if (role === "manager") {
    return mountBackOffice;
  }
  if (role === "care") {
    return path.startsWith("/care/orders/") ? mountCareOrder : mountCareSearch;
  }
  if (path.startsWith("/products/")) return mountProduct;
  if (path.startsWith("/cart")) return mountCart;
  if (path.startsWith("/orders/")) return mountOrder;
  return mountCatalogue;
}

function getRoot(): HTMLElement {
  // Remove any server-rendered main content from the placeholder body so the
  // client owns the page from here on.
  for (const node of Array.from(document.body.children)) {
    const id = node instanceof HTMLElement ? node.id : "";
    if (id !== "site-header" && id !== "storage-notice-slot" && !node.classList.contains("pin")) {
      node.remove();
    }
  }
  let root = document.getElementById("root");
  if (!root) {
    root = el("div");
    root.id = "root";
    document.body.appendChild(root);
  }
  clear(root);
  return root;
}

async function loadSession(api: Api): Promise<MeAnswer | null> {
  // Session probing must not trigger the unauthenticated redirect.
  try {
    return await fetch("/api/me", { credentials: "same-origin" }).then(async (res) => {
      if (!res.ok) return null;
      return (await res.json()) as MeAnswer;
    });
  } catch {
    return null;
  }
}

export function handleUnauthenticated(): void {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  saveCheckoutForSessionEnd();
  if (window.location.pathname !== "/sign-in") {
    navigateReplace(`/sign-in?next=${next}`);
    window.location.reload();
  }
}

function handleUnauthenticatedFor(userId: string): void {
  void userId;
  handleUnauthenticated();
}

export function saveCheckoutForSessionEnd(): void {
  const saved = readTabState();
  if (saved && saved.kind === "checkout") {
    writeTabState(saved);
  }
}

// --- Tab state persistence (sessionStorage, keyed by account) ---

export interface TabStateBase {
  kind: string;
  accountId: string;
}

export function readTabState(): (TabStateBase & Record<string, unknown>) | null {
  try {
    const raw = sessionStorage.getItem("tramela-state");
    if (!raw) return null;
    return JSON.parse(raw) as TabStateBase & Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readTabStateFor(kind: string, accountId: string): Record<string, unknown> | null {
  const saved = readTabState();
  if (!saved || saved.kind !== kind || saved.accountId !== accountId) return null;
  return saved;
}

export function writeTabState(state: TabStateBase & Record<string, unknown>): void {
  try {
    sessionStorage.setItem("tramela-state", JSON.stringify(state));
  } catch {
    void 0;
  }
}

export function clearTabState(): void {
  try {
    sessionStorage.removeItem("tramela-state");
  } catch {
    void 0;
  }
}

// --- Storage notice band ---

export function createStorageMonitor(api: Api): StorageStatusView {
  const slot = document.getElementById("storage-notice-slot") as HTMLElement;
  let down = false;
  let timer: number | null = null;

  const band = el("div");
  band.id = "storage-notice-band";
  band.setAttribute("role", "status");
  band.setAttribute("aria-label", "Storage notice");
  band.setAttribute("data-state", "closed");
  band.setAttribute("hidden", "hidden");
  band.textContent = "Order storage is unreachable. Placing orders, order documents and return labels are paused.";
  slot.appendChild(band);

  const setDown = (): void => {
    if (!down) {
      down = true;
      band.removeAttribute("hidden");
      band.setAttribute("data-state", reducedMotion() ? "open" : "opening");
      window.setTimeout(() => band.setAttribute("data-state", "open"), reducedMotion() ? 0 : 200);
    }
  };
  const setUp = (): void => {
    if (down) {
      down = false;
      band.setAttribute("data-state", "closing");
      window.setTimeout(() => {
        band.setAttribute("data-state", "closed");
        band.setAttribute("hidden", "hidden");
      }, reducedMotion() ? 0 : 200);
    }
  };

  return {
    setDown,
    setUp,
    isDown: () => down,
    start(): void {
      const check = async (): Promise<void> => {
        try {
          const answer = await api.get<{ storage: string }>("/api/status");
          if (answer.storage === "down") setDown();
          else setUp();
        } catch {
          void 0;
        }
      };
      void check();
      timer = window.setInterval(check, 3000);
    },
    stop(): void {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      clear(slot);
    },
  };
}

function hideStorageBand(): void {
  const slot = document.getElementById("storage-notice-slot");
  if (slot) clear(slot);
}

// --- Headers ---

function buildSignedOutHeader(): HTMLElement {
  const header = el("header");
  header.className = "site-header";
  const wordmark = el("a");
  wordmark.className = "wordmark";
  wordmark.href = "/";
  wordmark.textContent = "Tramela Estate";
  header.appendChild(wordmark);
  return header;
}

function buildSignedInHeader(ctx: AppContext): HTMLElement {
  const header = el("header");
  header.className = "site-header";
  const wordmark = el("a");
  wordmark.className = "wordmark";
  wordmark.href = roleLanding(ctx);
  wordmark.textContent = "Tramela Estate";
  header.appendChild(wordmark);

  const inlineWrap = el("span");
  inlineWrap.className = "header-inline";
  const opName = el("span");
  opName.textContent = ctx.me.operator.name;
  inlineWrap.appendChild(opName);

  if (ctx.me.user.role === "manager") {
    const switcher = el("select");
    switcher.setAttribute("aria-label", "Shop");
    for (const storeId of ctx.me.store_ids) {
      const option = el("option");
      option.value = storeId;
      option.textContent = storeId;
      if (window.location.pathname === `/shop/${storeId}`) option.selected = true;
      switcher.appendChild(option);
    }
    switcher.addEventListener("change", () => {
      navigate(`/shop/${switcher.value}`);
    });
    inlineWrap.appendChild(switcher);
  }

  const signOut = el("button");
  signOut.className = "btn small";
  signOut.textContent = "Sign out";
  signOut.addEventListener("click", async () => {
    ctx.api.nextGeneration();
    try {
      await ctx.api.del("/api/session");
    } catch (err) {
      if (!(err instanceof StaleAnswer) && !(err instanceof ApiFailure)) throw err;
    }
    clearTabState();
    navigateReplace("/sign-in");
    window.location.reload();
  });
  inlineWrap.appendChild(signOut);
  header.appendChild(inlineWrap);

  // Phone menu button (visible below 700px by CSS)
  const menuBtn = el("button");
  menuBtn.className = "btn small header-menu-btn";
  menuBtn.textContent = "Menu";
  menuBtn.setAttribute("aria-expanded", "false");
  header.appendChild(menuBtn);

  const menuSheet = el("div");
  menuSheet.className = "sheet drop-down";
  menuSheet.setAttribute("role", "dialog");
  menuSheet.setAttribute("aria-label", "Menu");
  menuSheet.setAttribute("hidden", "hidden");
  menuSheet.setAttribute("data-state", "closed");
  const menuName = el("p");
  menuName.textContent = ctx.me.operator.name;
  menuSheet.appendChild(menuName);
  if (ctx.me.user.role === "manager") {
    const switcher = el("select");
    switcher.setAttribute("aria-label", "Shop");
    for (const storeId of ctx.me.store_ids) {
      const option = el("option");
      option.value = storeId;
      option.textContent = storeId;
      if (window.location.pathname === `/shop/${storeId}`) option.selected = true;
      switcher.appendChild(option);
    }
    switcher.addEventListener("change", () => {
      closeMenu();
      navigate(`/shop/${switcher.value}`);
    });
    menuSheet.appendChild(switcher);
  }
  const menuSignOut = el("button");
  menuSignOut.className = "btn";
  menuSignOut.textContent = "Sign out";
  menuSignOut.addEventListener("click", async () => {
    ctx.api.nextGeneration();
    try {
      await ctx.api.del("/api/session");
    } catch {
      void 0;
    }
    clearTabState();
    navigateReplace("/sign-in");
    window.location.reload();
  });
  menuSheet.appendChild(menuSignOut);
  const menuClose = el("button");
  menuClose.className = "btn";
  menuClose.textContent = "Close menu";
  menuClose.addEventListener("click", () => closeMenu());
  menuSheet.appendChild(menuClose);
  document.body.appendChild(menuSheet);

  let menuOpen = false;
  function openMenu(): void {
    menuOpen = true;
    menuBtn.setAttribute("aria-expanded", "true");
    menuSheet.removeAttribute("hidden");
    menuSheet.setAttribute("data-state", reducedMotion() ? "open" : "opening");
    window.setTimeout(() => menuSheet.setAttribute("data-state", "open"), reducedMotion() ? 0 : 200);
    const first = menuSheet.querySelector<HTMLElement>("button, select");
    first?.focus();
  }
  function closeMenu(): void {
    menuOpen = false;
    menuBtn.setAttribute("aria-expanded", "false");
    menuSheet.setAttribute("data-state", "closing");
    window.setTimeout(() => {
      menuSheet.setAttribute("data-state", "closed");
      menuSheet.setAttribute("hidden", "hidden");
    }, reducedMotion() ? 0 : 200);
    menuBtn.focus();
  }
  menuBtn.addEventListener("click", () => {
    if (menuOpen) closeMenu();
    else openMenu();
  });
  menuSheet.addEventListener("keydown", (event) => {
    if (event.key === "Tab") trapTab(menuSheet, event);
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    }
  });

  return header;
}

function trapTab(container: HTMLElement, event: KeyboardEvent): void {
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>("button, select, input, [href], [tabindex]:not([tabindex='-1'])"),
  ).filter((node) => node.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function roleLanding(ctx: AppContext): string {
  if (ctx.role === "lead") return "/estate";
  if (ctx.role === "care") return "/care";
  if (ctx.role === "shopper") return "/catalogue";
  return `/shop/${ctx.me.store_ids[0] ?? ""}`;
}

// --- Landing ---

function mountLanding(root: HTMLElement, _api: Api): void {
  const main = el("main");
  main.id = "landing";
  const hero = el("section");
  hero.className = "hero";
  const left = el("div");
  left.className = "panel-white hero-left";
  const support = el("p");
  support.className = "support";
  support.textContent = "Every shop in your group, every tin on its shelves, every collection hour in its own local time.";
  left.appendChild(support);
  const signInLink = el("a");
  signInLink.className = "btn";
  signInLink.href = "/sign-in";
  signInLink.textContent = "Sign in";
  left.appendChild(signInLink);
  hero.appendChild(left);
  const right = el("div");
  right.className = "panel-charcoal hero-right";
  const mini = el("canvas");
  mini.className = "landing-mini-map";
  mini.setAttribute("aria-hidden", "true");
  right.appendChild(mini);
  hero.appendChild(right);
  main.appendChild(hero);

  const drawings = el("section");
  drawings.className = "panel-charcoal drawings";
  drawings.appendChild(toolDrawing("brush"));
  drawings.appendChild(toolDrawing("tin"));
  drawings.appendChild(toolDrawing("screw"));
  main.appendChild(drawings);

  for (const text of [
    "Groups of shops run every hold, sale and collection hour from one place.",
    "Stores publish hours that start on the day you choose, in their own timezone.",
  ]) {
    const section = el("section");
    section.className = "red-section";
    const measure = el("div");
    measure.className = "measure";
    measure.textContent = text;
    section.appendChild(measure);
    main.appendChild(section);
  }
  root.appendChild(main);
  drawMiniMap(mini);
}

function toolDrawing(kind: string): HTMLElement {
  const wrap = el("div");
  wrap.className = "tool-drawing";
  wrap.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 160 120");
  svg.setAttribute("width", "160");
  svg.setAttribute("height", "120");
  const shapes: Record<string, string[]> = {
    brush: [
      '<rect x="20" y="70" width="90" height="12" rx="4" fill="#fbe9e9"/>',
      '<rect x="105" y="60" width="30" height="30" rx="4" fill="#f2c9ce"/>',
      '<path d="M20 82 L14 104 L46 96 Z" fill="#a4112b"/>',
    ],
    tin: [
      '<rect x="45" y="30" width="70" height="70" rx="6" fill="#fbe9e9"/>',
      '<rect x="45" y="24" width="70" height="12" rx="4" fill="#f2c9ce"/>',
      '<circle cx="80" cy="66" r="16" fill="#a4112b"/>',
    ],
    screw: [
      '<rect x="76" y="20" width="8" height="80" rx="2" fill="#fbe9e9"/>',
      '<rect x="68" y="18" width="24" height="10" rx="3" fill="#f2c9ce"/>',
      '<path d="M76 100 L84 100 L80 112 Z" fill="#a4112b"/>',
    ],
  };
  svg.innerHTML = shapes[kind]?.join("") ?? "";
  wrap.appendChild(svg);
  return wrap;
}

function drawMiniMap(canvas: HTMLElement): void {
  const target = canvas as HTMLCanvasElement;
  const ctx = target.getContext("2d");
  if (!ctx) return;
  target.width = 600;
  target.height = 600;
  ctx.fillStyle = "#23201f";
  ctx.fillRect(0, 0, 600, 600);
  ctx.strokeStyle = "#f2c9ce";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(300, 180);
  ctx.lineTo(290, 260);
  ctx.lineTo(300, 320);
  ctx.lineTo(280, 360);
  ctx.lineTo(300, 420);
  ctx.lineTo(320, 470);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(120, 120, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(500, 150, 30, 0, Math.PI * 2);
  ctx.stroke();
  const dot = (x: number, y: number): void => {
    ctx.fillStyle = "#fbe9e9";
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
  };
  dot(310, 200);
  dot(295, 300);
  dot(320, 440);
  dot(120, 120);
  dot(500, 150);
}

// --- Not found ---

export function mountNotFound(root: HTMLElement): void {
  const main = el("main");
  main.className = "nf";
  const heading = el("h1");
  heading.textContent = "We couldn't find that page.";
  heading.tabIndex = -1;
  main.appendChild(heading);
  root.appendChild(main);
  heading.focus();
}

// --- Sign-in ---

function mountSignIn(root: HTMLElement, api: Api): void {
  const main = el("main");
  main.className = "signin";
  const h1 = el("h1");
  h1.className = "visually-hidden";
  h1.textContent = "Sign in";
  main.appendChild(h1);

  const params = historyParams();
  const next = params.get("next") ?? "";
  const savedState = readTabState();
  const sessionEnded = params.get("ended") === "1";

  const form = el("form");
  form.className = "signin-form";
  form.noValidate = true;
  const alertSlot = el("div");
  alertSlot.id = "sign-in-alert-slot";
  form.appendChild(alertSlot);

  const emailField = el("div");
  emailField.className = "field";
  const emailLabel = el("label");
  emailLabel.htmlFor = "email";
  emailLabel.textContent = "Email";
  const emailInput = el("input");
  emailInput.id = "email";
  emailInput.name = "email";
  emailInput.type = "email";
  emailInput.autocomplete = "username";
  emailInput.value = savedEmail();
  emailField.appendChild(emailLabel);
  emailField.appendChild(emailInput);
  form.appendChild(emailField);

  const passwordField = el("div");
  passwordField.className = "field";
  const passwordLabel = el("label");
  passwordLabel.htmlFor = "password";
  passwordLabel.textContent = "Password";
  const passwordInput = el("input");
  passwordInput.id = "password";
  passwordInput.name = "password";
  passwordInput.type = "password";
  passwordInput.autocomplete = "current-password";
  passwordField.appendChild(passwordLabel);
  passwordField.appendChild(passwordInput);
  form.appendChild(passwordField);

  const submit = el("button");
  submit.id = "sign-in-button";
  submit.type = "submit";
  submit.className = "btn";
  submit.textContent = "Sign in";
  form.appendChild(submit);

  main.appendChild(form);
  root.appendChild(main);

  const savedEmailValue = sessionStorage.getItem("tramela-signin-email") ?? "";
  if (savedEmailValue && !emailInput.value) emailInput.value = savedEmailValue;
  const savedFocus = sessionStorage.getItem("tramela-signin-focus");
  const savedAlert = sessionStorage.getItem("tramela-signin-alert");

  if (sessionEnded) {
    showAlert("Your session ended. Sign in to continue.");
  } else if (savedAlert) {
    showAlert(savedAlert);
    sessionStorage.removeItem("tramela-signin-alert");
  }

  emailInput.addEventListener("input", () => {
    sessionStorage.setItem("tramela-signin-email", emailInput.value);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.getAttribute("aria-disabled") === "true") return;
    sessionStorage.setItem("tramela-signin-email", emailInput.value);
    sessionStorage.setItem("tramela-signin-focus", document.activeElement?.id ?? "");
    showAlert("Signing in...");
    try {
      const answer = await api.post<{ landing: string }>("/api/session", {
        email: emailInput.value,
        password: passwordInput.value,
      });
      sessionStorage.removeItem("tramela-signin-alert");
      sessionStorage.removeItem("tramela-signin-email");
      sessionStorage.removeItem("tramela-signin-focus");
      api.nextGeneration();
      const target = next && roleOfNext(next, answer.landing) ? next : answer.landing;
      window.location.href = target;
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.body.code === "too_many_attempts") {
          passwordInput.value = "";
          showAlert(`Too many attempts. Try again in ${Math.ceil(Number(err.body.retry_after) / 60)} minutes.`);
          startLockTimer(Number(err.body.retry_after));
          const alertEl = alertSlot.querySelector<HTMLElement>(".alert");
          alertEl?.focus();
          return;
        }
        passwordInput.value = "";
        showAlert("Email or password is wrong.");
        emailInput.focus();
      }
    }
  });

  function startLockTimer(seconds: number): void {
    submit.setAttribute("aria-disabled", "true");
    let timer = el("div");
    timer.setAttribute("role", "timer");
    timer.setAttribute("aria-label", "Sign-in locked");
    timer.className = "num";
    let left = seconds;
    timer.textContent = `${left} s`;
    timer.setAttribute("data-seconds-left", String(left));
    form.insertBefore(timer, emailField);
    const interval = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(interval);
        timer.remove();
        submit.removeAttribute("aria-disabled");
        return;
      }
      timer.textContent = `${left} s`;
      timer.setAttribute("data-seconds-left", String(left));
    }, 1000);
  }

  function showAlert(text: string): void {
    clear(alertSlot);
    const alert = el("div");
    alert.className = "alert";
    alert.setAttribute("role", "alert");
    alert.setAttribute("tabindex", "-1");
    alert.textContent = text;
    alertSlot.appendChild(alert);
  }

  function savedEmail(): string {
    return "";
  }

  if (savedFocus === "password") passwordInput.focus();
  else if (savedFocus === "sign-in-button") submit.focus();
  else emailInput.focus();
}

function roleOfNext(next: string, landing: string): boolean {
  if (!next.startsWith("/")) return false;
  if (next.startsWith("/sign-in")) return false;
  if (landing.startsWith("/shop/") && next.startsWith("/shop/")) return true;
  if (next.startsWith(landing)) return true;
  return false;
}

// --- Boot ---

window.addEventListener("popstate", () => {
  void render();
});

void render();
