import { get } from "./api";
import { ApiFailure } from "./api";
import { copy } from "./copy";
import { anyDialogOpen, openDialog } from "./dialog";
import { clear, graphemeCount, h, icon, layout, setText } from "./dom";
import { navigate } from "./router";

const NAV_LINKS: [string, string][] = [
  ["/", "Pens"],
  ["/dives", "Dives"],
  ["/imports", "Imports"],
  ["/reports", "Reports"],
  ["/devices", "Devices"],
];

let updates: HTMLElement | null = null;
let updateTimer = 0;

export function consoleUpdates(): HTMLElement {
  if (!updates) {
    updates = h("div", {
      class: "console-updates",
      role: "status",
      "aria-label": "Console updates",
    });
  }
  return updates;
}

/// Announces changes from the other device, and toasts.
export function announce(message: string): void {
  const region = consoleUpdates();
  setText(region, message);
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(() => {
    if (region.textContent === message) setText(region, "");
  }, 6000);
}

export function buildTopBar(reportOnly: boolean): HTMLElement {
  const wordmark = h("a", { href: "/", "aria-label": "Pensight home", class: "wordmark" }, "Pensight");
  if (reportOnly) {
    return h("header", { class: "topbar" }, [
      wordmark,
      h("span", { class: "label" }, "Read-only report"),
      h("span", {}),
    ]);
  }
  const nav = h("nav", { "aria-label": "Main" });
  for (const [href, label] of NAV_LINKS) {
    nav.appendChild(h("a", { href, "data-nav": href }, label));
  }
  const search = h("button", { type: "button", class: "icon-button" }, "Search");
  search.addEventListener("click", () => openSearchDialog());

  const menu = h(
    "button",
    { type: "button", class: "icon-button phone-only" },
    [icon("menu"), h("span", {}, "Menu")],
  );
  menu.addEventListener("click", () => openMenuDialog());
  const right = h("div", { class: "bar-right" }, [menu, search]);
  return h("header", { class: "topbar" }, [wordmark, nav, right]);
}

export function markCurrentNav(path: string): void {
  for (const link of document.querySelectorAll<HTMLElement>("[data-nav]")) {
    const href = link.getAttribute("data-nav") ?? "";
    const current = href === "/" ? path === "/" || path.startsWith("/pens") : path === href;
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function openMenuDialog(): void {
  openDialog({
    name: "Menu",
    build: (handle) => {
      const list = h("div", { class: "dialog-menu", role: "navigation", "aria-label": "Main" });
      for (const [href, label] of NAV_LINKS) {
        const link = h("a", { href }, label);
        link.addEventListener("click", (event) => {
          event.preventDefault();
          handle.close();
          navigate(href);
        });
        list.appendChild(link);
      }
      return h("div", {}, [h("h2", {}, "Menu"), list]);
    },
  });
}

interface SearchResult {
  kind: string;
  id: string;
  label: string;
}

/// The results and status always describe the text now in the box: a late reply
/// to an earlier query is discarded.
export function openSearchDialog(): void {
  let sequence = 0;
  let debounce = 0;
  openDialog({
    name: "Search",
    build: (handle) => {
      const box = h("input", {
        type: "search",
        role: "searchbox",
        "aria-label": "Search farms, pens and defects",
        autocomplete: "off",
      });
      const results = h("ul", { class: "list", "aria-label": "Search results", role: "list" });
      const status = h("div", { role: "status", "aria-label": "Search status" });
      setText(status, copy.searchShort);

      const run = async () => {
        const text = box.value.trim();
        const token = ++sequence;
        if (graphemeCount(text) < 2) {
          clear(results);
          setText(status, copy.searchShort);
          return;
        }
        try {
          const payload = await get(`/api/search?q=${encodeURIComponent(text)}`);
          if (token !== sequence) return;
          const rows = payload.results as SearchResult[];
          clear(results);
          for (const row of rows) {
            const href =
              row.kind === "farm"
                ? `/#farm-${row.id}`
                : row.kind === "pen"
                  ? `/pens/${row.id}`
                  : `/pens/${penOfDefect(row.label)}?defect=${row.id}`;
            const link = h("a", { href }, row.label);
            link.addEventListener("click", (event) => {
              event.preventDefault();
              handle.close();
              navigate(href);
            });
            results.appendChild(h("li", {}, link));
          }
          setText(status, copy.searchResults(rows.length));
        } catch (failure) {
          if (token !== sequence) return;
          clear(results);
          setText(
            status,
            failure instanceof ApiFailure ? failure.message : copy.unreachable,
          );
        }
      };

      box.addEventListener("input", () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(run, 250);
      });
      return h("div", {}, [
        h("h2", {}, "Search"),
        h("label", { class: "field" }, [h("span", {}, "Search farms, pens and defects"), box]),
        status,
        results,
      ]);
    },
  });
}

/// Defect result labels read `<defect id> — <pen name>`; the pen id comes from
/// the pens the console already knows.
let penNames = new Map<string, string>();

export function rememberPenNames(pens: { id: string; name: string }[]): void {
  penNames = new Map(pens.map((pen) => [pen.name, pen.id]));
}

function penOfDefect(label: string): string {
  const name = label.split(" \u2014 ")[1] ?? "";
  return penNames.get(name) ?? "skv-01";
}

const SHORTCUTS: [string, string][] = [
  ["Left / Right Arrow", "Orbit 15\u00b0, or pan one panel in the flat chart"],
  ["Up / Down Arrow", "Tilt 10\u00b0, or pan one panel row in the flat chart"],
  ["+ or = / -", "Zoom in or out by 0.25\u00d7"],
  ["U", "Unwrap the net wall"],
  ["W", "Wrap the net wall"],
  ["N / P", "Select the next or previous defect"],
  ["E or Enter", "Open the editor for the selected defect"],
  ["M", "Toggle marking mode"],
  ["?", "Open this dialog"],
];

export function openShortcutsDialog(): void {
  openDialog({
    name: "Keyboard shortcuts",
    build: (handle) => {
      const list = h("ul", { class: "list" });
      for (const [keys, effect] of SHORTCUTS) {
        list.appendChild(
          h("li", {}, [h("kbd", {}, keys), " ", h("span", {}, effect)]),
        );
      }
      const close = h("button", { type: "button", class: "text-button" }, "Close");
      close.addEventListener("click", () => handle.close());
      return h("div", {}, [
        h("h2", {}, "Keyboard shortcuts"),
        list,
        h("div", { class: "actions" }, [close]),
      ]);
    },
  });
}

export function buildFooter(): HTMLElement {
  const footer = h("footer", {});
  footer.appendChild(h("div", { class: "big-wordmark" }, "Pensight"));
  const columns: [string, () => HTMLElement[]][] = [
    [
      "Console",
      () =>
        NAV_LINKS.map(([href, label]) => {
          const link = h("a", { href }, label);
          return h("li", {}, link);
        }),
    ],
    [
      "Data",
      () => [
        h("li", {}, [
          h(
            "a",
            { href: "/api/exports/defects.csv", download: "defects.csv" },
            "Export all defects (CSV)",
          ),
        ]),
      ],
    ],
    [
      "Help",
      () => {
        const button = h("button", { type: "button" }, "Keyboard shortcuts");
        button.addEventListener("click", () => openShortcutsDialog());
        return [h("li", {}, button)];
      },
    ],
  ];
  const phone = layout() === "phone";
  for (const [title, items] of columns) {
    const list = h("ul", {}, items());
    if (phone) {
      const sign = h("span", { "aria-hidden": "true" }, "+");
      const header = h(
        "button",
        {
          type: "button",
          class: "accordion-header",
          "aria-expanded": "false",
        },
        [h("span", {}, title), sign],
      );
      list.hidden = true;
      header.addEventListener("click", () => {
        const open = header.getAttribute("aria-expanded") === "true";
        header.setAttribute("aria-expanded", open ? "false" : "true");
        list.hidden = open;
        setText(sign, open ? "+" : "\u00d7");
      });
      footer.appendChild(h("div", {}, [header, list]));
    } else {
      footer.appendChild(h("div", {}, [h("div", { class: "label" }, title), list]));
    }
  }
  return footer;
}

export function shortcutsBlocked(target: EventTarget | null): boolean {
  if (anyDialogOpen()) return true;
  const node = target as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return node.isContentEditable;
}
