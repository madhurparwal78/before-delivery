// Router and boot. Published routes only; everything else is the not-found screen.
import { get, session, ApiError } from "./api.js";
import { h } from "./dom.js";
import { deskShell, publicShell } from "./shell.js";
import { closeAllDialogs } from "./dialog.js";
import * as home from "./views/home.js";
import * as signin from "./views/signin.js";
import * as board from "./views/board.js";
import * as windowDesk from "./views/desk.js";
import * as lots from "./views/lots.js";
import * as ledger from "./views/ledger.js";
import * as queue from "./views/queue.js";
import * as review from "./views/review.js";
import * as group from "./views/group.js";
import * as check from "./views/check.js";

const ANY = ["analyst", "verifier", "lead"];
const ROUTES = [
  { pattern: /^\/$/, view: home, shell: "public" },
  { pattern: /^\/sign-in$/, view: signin, shell: "public" },
  { pattern: /^\/check$/, view: check.search, shell: "public" },
  { pattern: /^\/check\/([^/]+)$/, view: check.statement, shell: "public" },
  { pattern: /^\/windows$/, view: board, shell: "desk", roles: ["analyst"] },
  { pattern: /^\/windows\/([^/]+)$/, view: windowDesk, shell: "desk", roles: ANY },
  { pattern: /^\/windows\/([^/]+)\/lots$/, view: lots, shell: "desk", roles: ["analyst"] },
  { pattern: /^\/windows\/([^/]+)\/ledger$/, view: ledger, shell: "desk", roles: ["analyst", "lead"] },
  { pattern: /^\/review$/, view: queue, shell: "desk", roles: ["verifier"] },
  { pattern: /^\/review\/([^/]+)$/, view: review, shell: "desk", roles: ["verifier"] },
  { pattern: /^\/group$/, view: group, shell: "desk", roles: ["lead"] },
];

const root = document.getElementById("app");
let shell = null;
let shellKind = null;
let current = null;
let currentKey = null;

export function navigate(url, { replace = false } = {}) {
  history[replace ? "replaceState" : "pushState"](null, "", url);
  return render();
}

function notFound(container) {
  container.replaceChildren(h("section", { class: "panel field-orange" },
    h("p", { class: "figure", text: "THAT PAGE DOES NOT EXIST." })));
  return { unmount() {} };
}

function match(pathname) {
  for (const route of ROUTES) {
    const found = pathname.match(route.pattern);
    if (found) return { route, params: found.slice(1).map(decodeURIComponent) };
  }
  return null;
}

function mountShell(kind) {
  if (shellKind === kind && shell) return;
  shell?.destroy();
  closeAllDialogs();
  shellKind = kind;
  shell = kind === "desk" ? deskShell(root, session.user, navigate) : publicShell(root);
}

async function render() {
  const found = match(location.pathname);
  const key = found ? location.pathname : null;
  if (found && current && key === currentKey && current.onUrl) {
    current.onUrl(new URLSearchParams(location.search));
    return;
  }
  current?.unmount?.();
  current = null;
  currentKey = key;
  closeAllDialogs();
  if (!found) {
    mountShell(session.user ? "desk" : "public");
    current = notFound(shell.view);
    return;
  }
  const { route, params } = found;
  if (route.shell === "desk" && !session.user) { navigate("/sign-in", { replace: true }); return; }
  mountShell(route.shell);
  if (route.roles && !route.roles.includes(session.user.role)) { current = notFound(shell.view); return; }
  current = route.view.mount({
    container: shell.view, params, query: new URLSearchParams(location.search), user: session.user, shell, navigate,
  });
}

document.addEventListener("click", (event) => {
  const anchor = event.target.closest("a[href]");
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || anchor.hasAttribute("download") || url.pathname.endsWith(".pdf")) return;
  if (anchor.getAttribute("href").startsWith("#")) return;
  event.preventDefault();
  navigate(url.pathname + url.search);
});
window.addEventListener("popstate", render);

const reduce = matchMedia("(prefers-reduced-motion: reduce)");
reduce.addEventListener("change", () => {
  document.documentElement.dataset.motion = reduce.matches ? "reduced" : "full";
});

const PUBLIC_PATHS = /^\/(check(\/[^/]+)?|sign-in)?$/;

async function boot() {
  if (!PUBLIC_PATHS.test(location.pathname)) {
    try {
      const { user } = await get("/api/me");
      session.user = user;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      session.user = null;
    }
  }
  await render();
}

boot();
