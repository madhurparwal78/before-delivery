import type { User, WorkspaceInfo } from "../shared/types.js";
import { api, SessionEnded, setPendingHandler } from "./api.js";
import { h, type Child } from "./dom.js";
import { setFeedback, alertFor } from "./ui.js";
import { renderSignIn } from "./screens/signin.js";
import { renderInbox } from "./screens/inbox.js";
import { renderFeatures } from "./screens/features.js";
import { renderFeatureDetail } from "./screens/feature-detail.js";
import { renderRoadmap } from "./screens/roadmap.js";
import { renderCompanies } from "./screens/companies.js";
import { renderImport } from "./screens/import.js";
import { renderSettings } from "./screens/settings.js";
import { renderInvite } from "./screens/invite.js";

export interface App {
  user: User;
  workspace: WorkspaceInfo;
}

let app: App | null = null;

export function currentApp(): App | null {
  return app;
}

const NAV = [
  { href: "/inbox", label: "Inbox" },
  { href: "/features", label: "Features" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/companies", label: "Companies" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
];

function navigate(path: string): void {
  if (location.pathname !== path) {
    history.pushState(null, "", path);
  }
  render();
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const link = target?.closest("a[data-nav]") as HTMLAnchorElement | null;
  if (link === null) return;
  event.preventDefault();
  navigate(link.getAttribute("href") ?? "/");
});

window.addEventListener("popstate", () => {
  render();
});

/**
 * The progress bar appears when a request runs longer than 0.3 seconds and
 * slides under the top bar until it finishes (DP-43).
 */
let openRequests = 0;
let progressBar: HTMLElement | null = null;
let progressDelay: number | undefined;

setPendingHandler({
  begin: () => {
    openRequests += 1;
    if (openRequests === 1) {
      window.clearTimeout(progressDelay);
      progressDelay = window.setTimeout(() => {
        if (openRequests > 0) progressBar?.classList.add("active");
      }, 300);
    }
  },
  end: () => {
    openRequests = Math.max(0, openRequests - 1);
    if (openRequests === 0) {
      window.clearTimeout(progressDelay);
      progressBar?.classList.remove("active");
    }
  },
});

/** The global search combobox with grouped results (DP-51). */
function buildSearch(): HTMLElement {
  const resultsId = "search-results";
  const input = h("input", {
    type: "search",
    role: "combobox",
    "aria-expanded": "false",
    "aria-controls": resultsId,
    "aria-autocomplete": "list",
    "aria-label": "Search workspace",
    placeholder: "Search notes, companies, features",
  }) as HTMLInputElement;
  const listbox = h("div", { id: resultsId, role: "listbox", class: "search-results", hidden: true });
  type Option = { kind: "note" | "company" | "feature"; id: string; label: string; snippet: string | null; href: string };
  let options: Option[] = [];
  let activeIndex = -1;
  let debounce: number | undefined;

  const paint = (): void => {
    listbox.replaceChildren();
    if (options.length === 0) {
      listbox.setAttribute("hidden", "");
      input.setAttribute("aria-expanded", "false");
      return;
    }
    listbox.removeAttribute("hidden");
    input.setAttribute("aria-expanded", "true");
    const groups: Array<[string, Option[]]> = [
      ["Notes", options.filter((o) => o.kind === "note")],
      ["Companies", options.filter((o) => o.kind === "company")],
      ["Features", options.filter((o) => o.kind === "feature")],
    ];
    for (const [label, groupOptions] of groups) {
      if (groupOptions.length === 0) continue;
      const group = h("div", { role: "group", "aria-label": label });
      group.appendChild(h("div", { class: "group-label" }, label));
      for (const option of groupOptions) {
        const globalIndex = options.indexOf(option);
        const optionEl = h("button", {
          role: "option",
          class: "search-option",
          "aria-selected": String(globalIndex === activeIndex),
          onclick: () => {
            close();
            navigate(option.href);
          },
        });
        optionEl.appendChild(h("strong", null, option.label));
        if (option.snippet !== null) {
          optionEl.appendChild(h("span", { class: "snippet" }, option.snippet));
        }
        group.appendChild(optionEl);
      }
      listbox.appendChild(group);
    }
  };

  const close = (): void => {
    options = [];
    activeIndex = -1;
    paint();
  };

  input.addEventListener("input", () => {
    window.clearTimeout(debounce);
    const q = input.value.trim();
    if (q.length < 2) {
      close();
      return;
    }
    debounce = window.setTimeout(async () => {
      try {
        const results = await api.search(q);
        options = [
          ...results.notes.map((n) => ({
            kind: "note" as const,
            id: n.id,
            label: n.title,
            snippet: n.snippet,
            href: `/inbox/${n.id}`,
          })),
          ...results.companies.map((c) => ({
            kind: "company" as const,
            id: c.id,
            label: c.name,
            snippet: c.domains.join(", "),
            href: `/companies/${c.id}`,
          })),
          ...results.features.map((f) => ({
            kind: "feature" as const,
            id: f.id,
            label: f.name,
            snippet: `${f.insightCount} insights · ${f.companyCount} companies`,
            href: `/features/${f.id}`,
          })),
        ];
        activeIndex = options.length > 0 ? 0 : -1;
        paint();
      } catch {
        close();
      }
    }, 250);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    if (options.length === 0) return;
    event.preventDefault();
    if (event.key === "ArrowDown") {
      activeIndex = (activeIndex + 1) % options.length;
    } else if (event.key === "ArrowUp") {
      activeIndex = (activeIndex - 1 + options.length) % options.length;
    } else if (event.key === "Enter" && activeIndex >= 0) {
      const chosen = options[activeIndex]!;
      close();
      navigate(chosen.href);
    }
    paint();
  });

  document.addEventListener("click", (event) => {
    const target = event.target as Node | null;
    if (target !== null && !listbox.contains(target) && target !== input) close();
  });

  const wrap = h("div", { class: "search-wrap" }, input, listbox);
  return wrap as HTMLElement;
}

function topbar(user: User, workspace: WorkspaceInfo): HTMLElement {
  const nav = h(
    "nav",
    { class: "main-nav", "aria-label": "Main" },
    NAV.filter((item) => item.href !== "/settings" || user.role === "head_of_product").map(
      (item) =>
        h(
          "a",
          {
            href: item.href,
            "data-nav": true,
            "aria-current":
              location.pathname === item.href || location.pathname.startsWith(`${item.href}/`)
                ? "page"
                : null,
          },
          item.label,
        ),
    ),
  );
  const signOut = h(
    "button",
    {
      onclick: async () => {
        try {
          await api.signOut();
        } catch {
          // Signing out ends the session regardless.
        }
        app = null;
        history.pushState(null, "", "/signin");
        render();
      },
    },
    "Sign out",
  );
  const bar = h(
    "header",
    { class: "topbar" },
    h("span", { class: "workspace-name" }, workspace.name),
    buildSearch(),
    nav,
    signOut,
  );
  return bar as HTMLElement;
}

function statusbar(): { root: HTMLElement; save: HTMLElement; evidence: HTMLElement; board: HTMLElement } {
  const save = h("p", { class: "status-output", role: "status", "aria-label": "Save status" });
  const evidence = h("p", { class: "status-output", role: "status", "aria-label": "Evidence announcements" });
  const board = h("p", { class: "status-output", role: "status", "aria-label": "Board announcements" });
  const root = h("div", { class: "statusbar" }, save, evidence, board) as HTMLElement;
  return { root, save, evidence, board };
}

let alertRegion: HTMLElement | null = null;

function setAlert(text: string): void {
  alertRegion?.replaceChildren(text);
}

async function render(): Promise<void> {
  const path = location.pathname;
  const root = document.getElementById("app")!;

  // Public and invitation pages do not need the shell.
  if (path.startsWith("/invite/")) {
    root.replaceChildren(await renderInvite(path.slice("/invite/".length)));
    return;
  }
  if (path === "/signin") {
    root.replaceChildren(renderSignIn(() => {
      navigate("/inbox");
    }));
    return;
  }

  if (app === null) {
    try {
      const me = await api.me();
      app = { user: me.user, workspace: me.workspace };
    } catch (err) {
      if (err instanceof SessionEnded) {
        history.pushState(null, "", "/signin");
        root.replaceChildren(renderSignIn(() => {
          navigate("/inbox");
        }));
        setAlert("Your session ended. Sign in again.");
        return;
      }
      root.replaceChildren(
        h("div", { class: "screen" }, h("p", null, alertFor(err))) as HTMLElement,
      );
      return;
    }
  }

  const shell = h("div", null);
  const bar = topbar(app.user, app.workspace);
  const status = statusbar();
  alertRegion = h("div", { class: "page-alert", role: "alert" });
  setFeedback({
    saveStatus: (text) => {
      status.save.replaceChildren(text);
    },
    evidence: (text) => {
      status.evidence.replaceChildren(text);
    },
    board: (text) => {
      status.board.replaceChildren(text);
    },
    alert: (text) => {
      setAlert(text);
    },
    clearAlert: () => {
      setAlert("");
    },
  });

  const screen = h("main", { class: "screen" });
  progressBar = h("div", { class: "progress" }, h("span", null));
  shell.appendChild(bar);
  shell.appendChild(progressBar);
  shell.appendChild(status.root);
  shell.appendChild(alertRegion);
  shell.appendChild(screen);

  const fail = (err: unknown): void => {
    if (err instanceof SessionEnded) {
      app = null;
      history.pushState(null, "", "/signin");
      render();
      return;
    }
    setAlert(alertFor(err));
  };

  let content: Child = null;
  if (path === "/inbox" || path.startsWith("/inbox/")) {
    content = await renderInbox(screen, path.slice("/inbox/".length) || null, fail);
  } else if (path === "/features") {
    content = await renderFeatures(screen, fail);
  } else if (path.startsWith("/features/")) {
    content = await renderFeatureDetail(screen, path.slice("/features/".length), fail);
  } else if (path === "/roadmap") {
    content = await renderRoadmap(screen, fail);
  } else if (path === "/companies") {
    content = await renderCompanies(screen, fail);
  } else if (path.startsWith("/companies/")) {
    content = await renderCompanies(screen, fail, path.slice("/companies/".length));
  } else if (path === "/import") {
    content = renderImport(screen, fail);
  } else if (path === "/settings") {
    content = await renderSettings(screen, fail);
  } else {
    history.pushState(null, "", "/inbox");
    content = await renderInbox(screen, null, fail);
  }

  root.replaceChildren(shell);
  if (content !== null) {
    screen.replaceChildren(content as HTMLElement);
  }
}

void render();
