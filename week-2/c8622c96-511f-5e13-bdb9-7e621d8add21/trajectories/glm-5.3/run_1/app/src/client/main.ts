// Saltprint Desk client: routes to each role's sections, keeps the contact
// sheet's state in its address, and signs people in and out.
import { api } from "./api.js";
import { el, clear, SECTION_ROUTES } from "./dom.js";
import { renderShell, type User } from "./shell.js";
import { renderSignIn } from "./signin.js";
import { SheetScreen } from "./sheet.js";
import { renderShortlist, renderFollowing } from "./social.js";
import { renderLicences, renderUsage } from "./licences.js";
import { renderStudio, renderRoyalties } from "./studio.js";
import { renderReviewQueue, renderAllEssays, renderRates, renderStatements } from "./desk.js";

let user: User | null = null;
let sheet: SheetScreen | null = null;
let returnPath: string | null = null;

async function loadUser(): Promise<User | null> {
  const result = await api.get<{ user: User }>("/api/me");
  if (result.status === 200) return (result.body as { user: User }).user;
  return null;
}

function firstSection(): string {
  const routes = SECTION_ROUTES[user?.role ?? ""] ?? ["/sheet"];
  return routes[0];
}

function hasSection(path: string): boolean {
  const routes = SECTION_ROUTES[user?.role ?? ""] ?? [];
  return routes.includes(path) || path === "/sheet";
}

async function render(pathname: string): Promise<void> {
  const root = document.getElementById("root");
  if (!root) return;
  if (!user) {
    renderSignIn(root, async () => {
      user = await loadUser();
      if (user) {
        const target = returnPath && hasSection(returnPath) ? returnPath : firstSection();
        returnPath = null;
        if (target !== window.location.pathname) window.history.replaceState({}, "", target);
        await render(target);
      }
    });
    return;
  }
  sheet?.dispose();
  sheet = null;
  const { main } = renderShell(root, user, pathname, async () => {
    await api.delete("/api/session");
    user = null;
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    await render(window.location.pathname);
  });
  switch (pathname) {
    case "/sheet":
    case "/":
      sheet = new SheetScreen(main, user);
      await sheet.render();
      break;
    case "/shortlist":
      await renderShortlist(main, user);
      break;
    case "/following":
      await renderFollowing(main);
      break;
    case "/licences":
      await renderLicences(main, user);
      break;
    case "/usage":
      await renderUsage(main);
      break;
    case "/studio":
      await renderStudio(main, user);
      break;
    case "/royalties":
      await renderRoyalties(main);
      break;
    case "/review-queue":
      await renderReviewQueue(main);
      break;
    case "/all-essays":
      await renderAllEssays(main);
      break;
    case "/rates":
      await renderRates(main);
      break;
    case "/statements":
      await renderStatements(main);
      break;
    default: {
      // Unknown app addresses go to the person's first section.
      const target = firstSection();
      window.history.replaceState({}, "", target);
      await render(target);
      return;
    }
  }
}

window.addEventListener("popstate", () => {
  const path = window.location.pathname;
  if (path === "/sheet" && sheet) {
    sheet.onPopState();
    return;
  }
  void render(path);
});

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName !== "A") return;
  const href = target.getAttribute("href");
  if (!href || href.startsWith("http") || href.startsWith("/api")) return;
  e.preventDefault();
  if (!user) returnPath = window.location.pathname + window.location.search;
  window.history.pushState({}, "", href);
  void render(href);
});

async function boot(): Promise<void> {
  user = await loadUser();
  await render(window.location.pathname);
}

void boot();

export { clear };
