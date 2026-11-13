import { loadSession, currentUser, setSession } from "./api.js";
import { setNavCurrent } from "./band.js";
import { deskError, h, deskStatus } from "./ui.js";
import { renderSignIn, renderSignUp } from "./pages/signin.js";
import { renderLeaderboard } from "./pages/leaderboard.js";
import { renderGallery } from "./pages/gallery.js";
import { renderStudioEntries, renderEntry } from "./pages/studio.js";
import { renderJury, renderConflicts, renderBallot } from "./pages/jury.js";
import { renderDirectorHome, renderDirectorProgram, renderDirectorCategory, renderDirectorRound, renderDirectorAudit } from "./pages/director.js";

const main = document.getElementById("main") as HTMLElement;
const navSession = document.getElementById("nav-session") as HTMLElement;

interface Route {
  pattern: RegExp;
  render: (params: string[]) => Promise<void>;
  guard: "public" | "studio" | "juror" | "director";
}

const routes: Route[] = [
  { pattern: /^\/$/, render: () => renderLeaderboard(main), guard: "public" },
  { pattern: /^\/gallery$/, render: () => renderGallery(main), guard: "public" },
  { pattern: /^\/signin$/, render: () => renderSignIn(main), guard: "public" },
  { pattern: /^\/signup$/, render: () => renderSignUp(main), guard: "public" },
  { pattern: /^\/studio$/, render: () => renderStudioEntries(main), guard: "studio" },
  { pattern: /^\/studio\/entries\/new$/, render: () => renderEntry(main, null), guard: "studio" },
  { pattern: /^\/studio\/entries\/([^/]+)$/, render: (m) => renderEntry(main, m[0]), guard: "studio" },
  { pattern: /^\/jury$/, render: () => renderJury(main), guard: "juror" },
  { pattern: /^\/jury\/conflicts$/, render: () => renderConflicts(main), guard: "juror" },
  { pattern: /^\/jury\/rounds\/([^/]+)$/, render: (m) => renderBallot(main, m[0]), guard: "juror" },
  { pattern: /^\/director$/, render: () => renderDirectorHome(main), guard: "director" },
  { pattern: /^\/director\/programs\/([^/]+)$/, render: (m) => renderDirectorProgram(main, m[0]), guard: "director" },
  { pattern: /^\/director\/categories\/([^/]+)$/, render: (m) => renderDirectorCategory(main, m[0]), guard: "director" },
  { pattern: /^\/director\/rounds\/([^/]+)$/, render: (m) => renderDirectorRound(main, m[0]), guard: "director" },
  { pattern: /^\/director\/audit$/, render: () => renderDirectorAudit(main), guard: "director" },
];

let navigationToken = 0;

export async function navigate(path: string, replace = false): Promise<void> {
  if (replace) {
    window.history.replaceState({}, "", path);
  } else {
    window.history.pushState({}, "", path);
  }
  await run(path);
}

async function run(path: string): Promise<void> {
  const token = ++navigationToken;
  deskError("");
  deskStatus("");
  setNavCurrent(path);
  const route = routes.find((r) => r.pattern.test(stripQuery(path)));
  if (!route) {
    if (stripQuery(path) !== "/") {
      await navigate("/", true);
      return;
    }
    return;
  }
  const user = currentUser();
  if (route.guard !== "public") {
    if (!user) {
      sessionStorage.setItem("cutline-after-signin", path);
      await navigate("/signin", true);
      return;
    }
    const roleOk =
      (route.guard === "studio" && user.role === "studio") ||
      (route.guard === "juror" && user.role === "juror") ||
      (route.guard === "director" && user.role === "director");
    if (!roleOk) {
      renderForbidden(main, route.guard);
      return;
    }
  }
  const matches = stripQuery(path).match(route.pattern)?.slice(1) ?? [];
  try {
    await route.render(matches);
  } catch (error) {
    if (token !== navigationToken) {
      return;
    }
    console.error(error);
  }
}

function stripQuery(path: string): string {
  const stripped = path.split("?")[0];
  return stripped.length > 1 && stripped.endsWith("/") ? stripped.slice(0, -1) : stripped || "/";
}

function renderForbidden(container: HTMLElement, guard: string): void {
  container.textContent = "";
  container.append(
    h("div", { class: "error-page" },
      h("h1", { class: "page-title", text: "Not your desk" }),
      h("p", { text: guard === "studio" ? "Only studio entrants can open this page." : guard === "juror" ? "Only jurors can open this page." : "Only the program director can open this page." }),
      h("p", {}, h("a", { href: "/", text: "Back to the leaderboard" })),
    ),
  );
}

function renderSessionNav(): void {
  const user = currentUser();
  navSession.textContent = "";
  if (user) {
    navSession.append(h("button", {
      text: "Sign out",
      class: "linkish",
      type: "button",
      onclick: async () => {
        await fetch("/api/session", { method: "DELETE" });
        setSession(null);
        renderSessionNav();
        await navigate("/");
      },
    }));
  } else {
    navSession.append(h("a", { href: "/signin", class: "session-link", text: "Sign in" }));
  }
}

async function boot(): Promise<void> {
  document.body.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a[href^='/']");
    if (!link || link.hasAttribute("download")) {
      return;
    }
    event.preventDefault();
    void navigate(link.getAttribute("href") ?? "/");
  });
  window.addEventListener("popstate", () => {
    void run(window.location.pathname);
  });
  await loadSession();
  renderSessionNav();
  const afterSignin = sessionStorage.getItem("cutline-after-signin");
  const path = window.location.pathname || "/";
  if (afterSignin && currentUser()) {
    sessionStorage.removeItem("cutline-after-signin");
    await navigate(afterSignin, true);
  } else {
    window.history.replaceState({}, "", path);
    await run(path);
  }
}

void boot();
