// The command palette: commands by the published fuzzy score and notes by
// the published ranking, only ever for the text now in the box.

import { api, type SearchResultJson } from "./api.js";
import { h, openDialog } from "./dom.js";
import { SEARCH_DEBOUNCE } from "./constants.js";
import { commandScore } from "../shared/ranking.js";
import { state, navigate, openNewTypeDialog } from "./app.js";
import { applyTheme } from "./settings.js";

interface Command {
  name: string;
  run: () => void;
}

export function openPalette(): void {
  const searchBox = h("input", { type: "text", "aria-label": "Search Quire", class: "palette-search", role: "combobox", "aria-expanded": "true", "aria-controls": "palette-results" });
  const commandsList = h("ul", { role: "group", "aria-label": "Commands", class: "palette-group" });
  const notesList = h("ul", { role: "group", "aria-label": "Notes", class: "palette-group" });
  const listbox = h("ul", { id: "palette-results", role: "listbox", "aria-label": "Palette results", class: "palette-results" }, commandsList, notesList);
  const status = h("div", { role: "status", "aria-live": "polite", "aria-label": "Palette status", class: "palette-status" });

  const commands: Command[] = [
    { name: "Go to Today", run: () => { window.__quireDailyReveal = true; void navigate("/today"); } },
    { name: "Open graph", run: () => void navigate("/graph") },
    { name: "Open timeline", run: () => void navigate("/timeline") },
    { name: "Open queries", run: () => void navigate("/queries") },
    { name: "Open settings", run: () => void navigate("/settings") },
    { name: state.app?.theme === "lamplight" ? "Switch to Paper" : "Switch to Lamplight", run: () => { void saveTheme(state.app?.theme === "lamplight" ? "paper" : "lamplight"); } },
    { name: "New type", run: () => openNewTypeDialog() },
  ];

  const saveTheme = async (theme: "paper" | "lamplight"): Promise<void> => {
    try {
      await api("PUT", "/api/settings", { theme });
      if (state.app !== null) state.app.theme = theme;
      applyTheme(theme);
      const { announce } = await import("./dom.js");
      announce(`Theme set to ${theme === "paper" ? "Paper" : "Lamplight"}.`);
    } catch {
      // keep the current theme
    }
  };

  interface Option {
    kind: "command" | "note";
    element: HTMLElement;
    run: () => void;
  }
  let options: Option[] = [];
  let active = 0;
  let noteToken = 0;
  let closed = false;

  const renderActive = (): void => {
    options.forEach((o, i) => {
      o.element.setAttribute("aria-selected", String(i === active));
      o.element.classList.toggle("active", i === active);
    });
    options[active]?.element.scrollIntoView({ block: "nearest" });
    const c = options.filter((o) => o.kind === "command").length;
    const n = options.filter((o) => o.kind === "note").length;
    status.textContent = `${c} ${c === 1 ? "command" : "commands"}, ${n} ${n === 1 ? "note" : "notes"}`;
  };

  const runActive = (): void => {
    const opt = options[active];
    if (opt === undefined) return;
    opt.run();
    close();
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    handle.close();
    overlay.remove();
  };

  const rebuild = async (): Promise<void> => {
    const q = searchBox.value;
    // commands: filtered and ordered on every keystroke by the command score
    commandsList.replaceChildren();
    const scored = commands
      .map((c) => ({ c, score: commandScore(c.name, q) }))
      .filter((x) => x.score !== null)
      .sort((a, b) => (b.score as number) - (a.score as number));
    options = [];
    scored.forEach((x) => {
      const el = h("li", { role: "option", class: "palette-option command" }, x.c.name);
      el.addEventListener("click", () => {
        x.c.run();
        close();
      });
      commandsList.append(el);
      options.push({ kind: "command", element: el, run: () => { x.c.run(); } });
    });
    // notes: searched for the text now in the box
    if (q.trim().length === 0) {
      notesList.replaceChildren();
    } else {
      const token = ++noteToken;
      try {
        const res = await api<{ results: SearchResultJson[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`);
        if (token !== noteToken || searchBox.value !== q) return; // a later answer wins
        notesList.replaceChildren();
        for (const r of res.results) {
          const snippet = h("span", { class: "palette-snippet" });
          for (const seg of r.snippet) {
            snippet.append(h(seg.match ? "mark" : "span", { class: seg.match ? "palette-match" : "palette-seg" }, seg.text));
          }
          const el = h("li", { role: "option", class: "palette-option note", "aria-describedby": `note-${r.object_id}` },
            h("span", { class: "palette-note-title" }, `${r.title}, ${r.type_name}`),
            h("span", { id: `note-${r.object_id}`, class: "palette-note-snippet" }, snippet)
          );
          el.addEventListener("click", () => {
            void navigate(`/o/${r.object_id}`);
            close();
          });
          notesList.append(el);
          options.push({ kind: "note", element: el, run: () => { void navigate(`/o/${r.object_id}`); } });
        }
      } catch {
        if (token === noteToken) notesList.replaceChildren();
      }
    }
    active = 0;
    renderActive();
  };

  const dialog = h("div", { role: "dialog", "aria-label": "Command palette", class: "dialog palette-dialog" },
    searchBox,
    listbox,
    status
  );
  const overlay = h("div", { class: "dialog-overlay" }, dialog);
  document.body.append(overlay);
  const handle = openDialog(overlay, document.activeElement as HTMLElement | null);
  dialog.addEventListener("dialog-close", () => {
    if (!closed) {
      closed = true;
      overlay.remove();
      handle.close();
    }
  });

  let debounce = 0;
  searchBox.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void rebuild(), SEARCH_DEBOUNCE);
  });
  searchBox.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length === 0) return;
      if (e.key === "ArrowDown") active = (active + 1) % options.length;
      else active = (active - 1 + options.length) % options.length;
      renderActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      runActive();
    }
  });
  searchBox.focus();
  void rebuild();
}
