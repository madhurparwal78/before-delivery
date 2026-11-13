/**
 * Explore: query bar with suggestions, filter pills, histogram with Bucket Brush,
 * field list with statistics, the virtual events grid and the document panel.
 */
import { addLiveHandler, announce, api, ApiFail, displayIso, displayTime, refreshTime, serverNow, showNotice, me } from "./api";
import { currentRoute, emptyBand, navigate, namedAlert } from "./shell";
import { openModal, openSheet } from "./modals";
import { animate, batch, effect, h, renderList, signal, text } from "./core";
import type { Filter, FlattenedEvent } from "../shared/types";

interface PillFilter extends Filter {
  disabled?: boolean;
}
import { buildBuckets, chooseInterval } from "../shared/histogram";
import { formatInZone, parseWallTime } from "../shared/tz";
import { fmtFixed } from "../shared/util";

interface StreamSummary {
  name: string;
  write_generation: number;
  events: number;
  failures: number;
}

interface FieldInfo {
  field: string;
  type: string;
  conflict?: string;
}

interface Stats {
  field: string;
  present: number;
  total: number;
  top: { value: string; count: number; share: string }[];
}

interface SuggestItem {
  label: string;
  insert: string;
  count?: number;
}

interface BucketInfo {
  start: number;
  end: number;
  count: number;
  label: string;
}

const F6_REGIONS = ["query", "histogram", "fields", "grid", "document"] as const;

function timeZone(): string {
  return me()?.time_zone ?? "UTC";
}

export function buildExplore(view: HTMLElement): void {
  const layout = h("div", { class: "explore-layout" });
  layout.style.padding = "10px 14px";

  // ---------- State ----------
  const params = new URLSearchParams(location.search);
  const streamName = signal<string>("");
  const queryText = signal<string>("");
  const filters = signal<PillFilter[]>([]);
  const fromMs = signal<number>(0);
  const toMs = signal<number>(0);
  const streams = signal<StreamSummary[]>([]);
  const total = signal<number>(0);
  const events = signal<FlattenedEvent[]>([]);
  const searchState = signal<"loading" | "done" | "error">("loading");
  const searchError = signal<string>("");
  const queryError = signal<{ message: string; position: number } | null>(null);
  const interval = signal<string>("1m");
  const buckets = signal<BucketInfo[]>([]);
  const partialResults = signal<{ skipped: number } | null>(null);
  const snapshotExpired = signal(false);
  const fields = signal<FieldInfo[]>([]);
  const selectedField = signal<string>("");
  const stats = signal<Stats | null>(null);
  const columns = signal<string[]>(["@timestamp", "host", "level", "message"]);
  const sort = signal<{ field: string; dir: "asc" | "desc" } | null>(null);
  const snapshotId = signal<string | null>(null);
  const newEvents = signal<number>(0);
  const documentEvent = signal<FlattenedEvent | null>(null);
  const surrounding = signal<FlattenedEvent[]>([]);
  const explain = signal<{ value: number; text: string; children: { text: string }[] } | null>(null);
  const layoutBand = signal<"phone" | "tablet" | "desk">("desk");

  function readLayout(): void {
    const w = window.innerWidth;
    layoutBand.set(w < 768 ? "phone" : w < 1100 ? "tablet" : "desk");
  }
  readLayout();
  window.addEventListener("resize", readLayout);

  function syncAddress(): void {
    const q = new URLSearchParams();
    if (streamName()) q.set("stream", streamName());
    q.set("from", new Date(fromMs()).toISOString());
    q.set("to", new Date(toMs()).toISOString());
    const path = `/explore?${q.toString()}`;
    history.replaceState(null, "", path);
  }

  function readAddress(): void {
    const p = new URLSearchParams(location.search);
    const s = p.get("stream");
    if (s) streamName.set(s);
    const to = p.get("to");
    const from = p.get("from");
    toMs.set(to ? Date.parse(to) : serverNow());
    fromMs.set(from ? Date.parse(from) : toMs() - 900000);
  }

  // ---------- Query bar ----------
  const bar = h("div", { class: "explore-top" });
  const streamCombo = h("select", { class: "input mono", "aria-label": "Stream" }) as HTMLSelectElement;
  streamCombo.style.width = "130px";
  const comboBox = h("div", { class: "query-pill" });
  comboBox.style.flex = "1";
  comboBox.style.display = "flex";
  comboBox.style.alignItems = "center";
  comboBox.style.gap = "6px";
  comboBox.style.border = "1px solid var(--border)";
  comboBox.style.borderRadius = "999px";
  comboBox.style.padding = "4px 12px";
  comboBox.style.minHeight = "44px";
  comboBox.style.background = "#fffdf7";
  comboBox.style.position = "relative";

  const queryInput = document.createElement("input");
  queryInput.className = "mono";
  queryInput.setAttribute("role", "combobox");
  queryInput.setAttribute("aria-expanded", "false");
  queryInput.setAttribute("aria-autocomplete", "list");
  queryInput.setAttribute("aria-label", "Query");
  queryInput.placeholder = "Search events";
  queryInput.style.flex = "1";
  queryInput.style.border = "none";
  queryInput.style.background = "transparent";
  queryInput.style.outline = "none";
  queryInput.style.fontSize = "14px";

  const listBox = h("ul", { role: "listbox", "aria-label": "Suggestions", id: "suggestions" });
  listBox.style.position = "absolute";
  listBox.style.top = "100%";
  listBox.style.left = "0";
  listBox.style.right = "0";
  listBox.style.margin = "4px 0 0";
  listBox.style.padding = "0";
  listBox.style.listStyle = "none";
  listBox.style.background = "var(--paper)";
  listBox.style.border = "1px solid var(--border)";
  listBox.style.borderRadius = "4px";
  listBox.style.maxHeight = "240px";
  listBox.style.overflow = "auto";
  listBox.style.zIndex = "30";
  listBox.style.display = "none";

  const suggestionState = signal<{ items: SuggestItem[]; highlighted: number }>({ items: [], highlighted: -1 });
  const suggestionsOpen = signal(false);

  effect(() => {
    const open = suggestionsOpen();
    queryInput.setAttribute("aria-expanded", String(open));
    listBox.style.display = open ? "block" : "none";
  });

  function closeSuggestions(): void {
    suggestionsOpen.set(false);
    suggestionState.set({ items: [], highlighted: -1 });
  }

  async function refreshSuggestions(): Promise<void> {
    if (queryText() === "" && queryInput.value === "") return;
    const cursor = queryInput.selectionStart ?? 0;
    try {
      const res = await api<{ kind: string; items: SuggestItem[] }>(
        `/api/suggest?stream=${encodeURIComponent(streamName())}&q=${encodeURIComponent(queryInput.value)}&cursor=${cursor}&from=${new Date(fromMs()).toISOString()}&to=${new Date(toMs()).toISOString()}`,
      );
      if (res.items.length > 0) {
        suggestionState.set({ items: res.items, highlighted: -1 });
        suggestionsOpen.set(true);
      } else {
        closeSuggestions();
      }
    } catch {
      closeSuggestions();
    }
  }

  queryInput.addEventListener("input", () => {
    queryText.set(queryInput.value);
    queryError.set(null);
    void refreshSuggestions();
  });
  queryInput.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") void refreshSuggestions();
  });
  queryInput.addEventListener("keydown", (e) => {
    const state = suggestionState();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!suggestionsOpen()) return;
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(state.items.length - 1, Math.max(0, state.highlighted + delta));
      suggestionState.set({ items: state.items, highlighted: next });
      const option = listBox.children[next] as HTMLElement | undefined;
      if (option) {
        queryInput.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    if (e.key === "Tab" && suggestionsOpen() && state.highlighted >= 0) {
      e.preventDefault();
      acceptSuggestion(state.items[state.highlighted]);
      return;
    }
    if (e.key === "Enter") {
      closeSuggestions();
      void runSearch();
      return;
    }
    if (e.key === "Escape") {
      closeSuggestions();
    }
  });
  queryInput.addEventListener("focus", () => {
    comboBox.style.borderColor = "var(--accent)";
  });
  queryInput.addEventListener("blur", () => {
    comboBox.style.borderColor = "var(--border)";
  });

  /** Accept a suggestion: replace the fragment just before the caret, add nothing else. */
  function acceptSuggestion(item: SuggestItem): void {
    const before = queryInput.value.slice(0, queryInput.selectionStart ?? 0);
    const after = queryInput.value.slice(queryInput.selectionEnd ?? 0);
    // The fragment replaced: the word typed so far (letters, digits, dots and dashes).
    const fragMatch = /([A-Za-z0-9_.\-]*)$/.exec(before);
    const frag = fragMatch ? fragMatch[1] : "";
    const next = before.slice(0, before.length - frag.length) + item.insert + after;
    queryInput.value = next;
    queryText.set(next);
    const caret = before.length - frag.length + item.insert.length;
    queryInput.setSelectionRange(caret, caret);
    closeSuggestions();
    void refreshSuggestions();
  }

  renderList(
    listBox,
    () => suggestionState().items,
    (item) => item.label,
    (item, i, li) => {
      li.style.padding = "10px 12px";
      li.style.minHeight = "36px";
      li.style.display = "flex";
      li.style.justifyContent = "space-between";
      li.style.cursor = "pointer";
      li.setAttribute("role", "option");
      li.id = `sug-${i}`;
      if (i === suggestionState().highlighted) {
        li.style.background = "var(--wash)";
        li.setAttribute("aria-selected", "true");
      } else {
        li.style.background = "transparent";
        li.removeAttribute("aria-selected");
      }
      text(li, item.label);
      // replace content
      li.textContent = "";
      li.append(Object.assign(document.createElement("span"), { textContent: item.label }));
      if (item.count !== undefined) {
        li.append(Object.assign(document.createElement("span"), { textContent: String(item.count), className: "muted mono" }));
      }
      li.onmousedown = (e) => {
        e.preventDefault();
        acceptSuggestion(item);
      };
    },
    () => document.createElement("li"),
  );

  comboBox.append(queryInput, listBox);

  const rangeButton = h("button", { class: "btn" }, "Time range");
  const rangeText = h("span", { class: "mono muted" });
  rangeText.style.fontSize = "12px";

  bar.append(streamCombo, comboBox, rangeButton, rangeText);

  // ---------- Filter pills ----------
  const pillRow = h("div", { class: "filter-row", role: "list", "aria-label": "Filters" });
  pillRow.style.display = "flex";
  pillRow.style.gap = "6px";
  pillRow.style.flexWrap = "wrap";
  pillRow.style.marginTop = "8px";

  effect(() => {
    const list = filters();
    pillRow.replaceChildren();
    list.forEach((f, idx) => {
      const pill = h("button", {
        class: "pill mono",
        role: "listitem",
        "aria-label": `Filter ${f.field}: ${String(f.value)}, ${f.op === "eq" ? "include" : "exclude"}, ${f.disabled ? "disabled" : "enabled"}`,
      }, `${f.field}: ${String(f.value)}`);
      const menu = h("div", { role: "menu", "aria-label": "Filter actions" });
      menu.style.display = "none";
      menu.style.position = "absolute";
      const mk = (label: string, action: () => void): HTMLElement => {
        const item = h("button", { role: "menuitem" }, label);
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          action();
          menu.remove();
        });
        return item;
      };
      pill.addEventListener("click", () => {
        if (menu.parentElement) {
          menu.remove();
          return;
        }
        menu.replaceChildren(
          mk("Invert", () => {
            filters.set(list.map((x, i) => (i === idx ? { ...x, op: x.op === "eq" ? "ne" : "eq" } : x)));
            void runSearch();
          }),
          mk(list[idx].disabled ? "Enable" : "Disable", () => {
            filters.set(list.map((x, i) => (i === idx ? { ...x, disabled: !x.disabled } : x)));
            void runSearch();
          }),
          mk("Remove", () => {
            filters.set(list.filter((_, i) => i !== idx));
            void runSearch();
          }),
        );
        menu.style.display = "block";
        const rect = pill.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${rect.left}px`;
        menu.style.background = "var(--paper)";
        menu.style.border = "1px solid var(--border)";
        menu.style.zIndex = "60";
        menu.style.minWidth = "140px";
        document.body.append(menu);
      });
      pillRow.append(pill);
    });
  });

  // ---------- Histogram ----------
  const intervalLabel = h("div", { class: "mono muted" });
  intervalLabel.style.fontSize = "12px";
  const histogram = h("div", { role: "group", "aria-label": "Histogram", class: "histogram" });
  histogram.style.position = "relative";
  histogram.style.background = "var(--surface)";
  histogram.style.border = "1px solid var(--hairline)";
  histogram.style.borderRadius = "4px";
  histogram.style.padding = "8px 8px 4px";
  histogram.style.marginTop = "10px";
  histogram.style.height = "120px";
  histogram.style.display = "flex";
  histogram.style.alignItems = "flex-end";
  histogram.style.gap = "2px";
  histogram.tabIndex = 0;

  let focusedBucket = 0;
  const selection = signal<{ from: number; to: number } | null>(null);

  const bucketEls: HTMLElement[] = [];
  effect(() => {
    const list = buckets();
    histogram.replaceChildren();
    bucketEls.length = 0;
    const max = Math.max(1, ...list.map((b) => b.count));
    list.forEach((b, i) => {
      const btn = h("button", {
        class: "bucket mono",
        "aria-label": `Bucket ${b.label}, ${b.count} ${b.count === 1 ? "event" : "events"}`,
      });
      const height = Math.round((b.count / max) * 86);
      btn.style.width = "16px";
      btn.style.height = `${Math.max(2, height)}px`;
      btn.style.background = "var(--accent)";
      btn.style.border = "none";
      btn.style.borderRadius = "2px 2px 0 0";
      btn.style.padding = "0";
      btn.style.margin = "0";
      btn.style.minHeight = "2px";
      btn.style.position = "relative";
      btn.dataset.index = String(i);
      const sel = selection();
      if (sel && i >= sel.from && i <= sel.to) {
        btn.setAttribute("data-selected", "true");
      } else {
        btn.removeAttribute("data-selected");
      }
      if (i === focusedBucket) {
        btn.style.outline = "2px solid var(--accent)";
        btn.style.outlineOffset = "2px";
      } else {
        btn.style.outline = "none";
      }
      bucketEls.push(btn);
      histogram.append(btn);
    });
  });

  // bar-settle animation on bucket height changes
  const prevHeights = new Map<number, number>();
  effect(() => {
    const list = buckets();
    const max = Math.max(1, ...list.map((b) => b.count));
    list.forEach((b, i) => {
      const el = bucketEls[i];
      if (!el) return;
      const height = Math.max(2, Math.round((b.count / max) * 86));
      const prev = prevHeights.get(i);
      if (prev !== undefined && prev !== height) {
        animate(el, "bar-settle", [{ height: `${prev}px` }, { height: `${height}px` }], {
          duration: 200,
          easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
        });
      }
      if (prev === undefined && b.count > 0) {
        animate(el, "bar-settle", [{ height: "2px" }, { height: `${height}px` }], {
          duration: 200,
          easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
        });
      }
      prevHeights.set(i, height);
    });
  });

  function applyBrush(from: number, to: number): void {
    const list = buckets();
    if (list.length === 0) return;
    const a = list[Math.max(0, from)];
    const b = list[Math.min(list.length - 1, to)];
    fromMs.set(a.start);
    toMs.set(b.end);
    syncAddress();
    selection.set(null);
    void runSearchWithAnnouncement((n) => `Time range set: ${n} ${n === 1 ? "event" : "events"} found`);
    // Enter puts focus on the first bucket of the new range.
    focusedBucket = 0;
    setTimeout(() => focusBucket(), 100);
  }

  // pointer Bucket Brush
  let dragFrom = -1;
  histogram.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement;
    const idx = Number(target.dataset.index ?? -1);
    if (idx >= 0) dragFrom = idx;
  });
  histogram.addEventListener("pointermove", (e) => {
    if (dragFrom < 0) return;
    const els = Array.from(histogram.querySelectorAll<HTMLElement>("[data-index]"));
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right) {
        const idx = Number(el.dataset.index);
        const a = Math.min(dragFrom, idx);
        const b = Math.max(dragFrom, idx);
        selection.set({ from: a, to: b });
        break;
      }
    }
  });
  window.addEventListener("pointerup", () => {
    if (dragFrom < 0) return;
    const sel = selection();
    if (sel) {
      applyBrush(sel.from, sel.to);
    } else {
      applyBrush(dragFrom, dragFrom);
    }
    dragFrom = -1;
  });

  // keyboard Bucket Brush
  histogram.addEventListener("keydown", (e) => {
    const list = buckets();
    if (list.length === 0) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      if (e.shiftKey) {
        const sel = selection();
        const from = sel ? sel.from : focusedBucket;
        const to = Math.min(list.length - 1, Math.max(0, (sel ? sel.to : focusedBucket) + delta));
        selection.set({ from: Math.min(from, to), to: Math.max(from, to) });
        focusedBucket = Math.max(from, to);
        focusBucket();
      } else {
        selection.set(null);
        focusedBucket = Math.min(list.length - 1, Math.max(0, focusedBucket + delta));
        focusBucket();
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const sel = selection();
      if (sel) applyBrush(sel.from, sel.to);
      else applyBrush(focusedBucket, focusedBucket);
      return;
    }
    if (e.key === "Escape") {
      selection.set(null);
    }
  });
  function focusBucket(): void {
    const el = bucketEls[focusedBucket];
    if (el) el.focus();
  }
  histogram.addEventListener("focusin", () => {
    const el = bucketEls[focusedBucket];
    if (el && document.activeElement !== el) el.focus();
  });
  histogram.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });

  // ---------- Field list and statistics ----------
  const fieldList = h("div", { role: "list", "aria-label": "Fields" });
  fieldList.style.display = "flex";
  fieldList.style.flexDirection = "column";
  fieldList.style.gap = "2px";
  const statsRegion = h("div", { role: "region", "aria-label": "Field statistics" });

  renderList(
    fieldList,
    () => fields(),
    (f) => f.field,
    (f, _i, item) => {
      item.setAttribute("role", "listitem");
      item.style.display = "contents";
      const btn = h("button", {
        class: "mono field-btn",
        "aria-label": f.conflict ? `Field ${f.field}, conflict, ${f.conflict}` : `Field ${f.field}, ${f.type}`,
      }, f.conflict ? `${f.field} (${f.type}, Conflict)` : `${f.field} (${f.type})`);
      btn.style.display = "block";
      btn.style.width = "100%";
      btn.style.textAlign = "left";
      btn.style.padding = "6px 8px";
      btn.style.background = selectedField() === f.field ? "var(--wash)" : "transparent";
      btn.style.border = "none";
      btn.style.borderBottom = "1px solid var(--hairline)";
      btn.style.fontSize = "12px";
      btn.style.minHeight = "44px";
      btn.addEventListener("click", () => {
        selectedField.set(f.field);
        void loadStats();
      });
      item.replaceChildren(btn);
    },
    () => {
      const li = document.createElement("div");
      li.setAttribute("role", "listitem");
      return li;
    },
  );

  async function loadStats(): Promise<void> {
    const field = selectedField();
    if (!field) {
      stats.set(null);
      return;
    }
    try {
      const s = await api<Stats>(
        `/api/fields/stats?field=${encodeURIComponent(field)}&stream=${encodeURIComponent(streamName())}&q=${encodeURIComponent(queryText())}&from=${new Date(fromMs()).toISOString()}&to=${new Date(toMs()).toISOString()}`,
      );
      stats.set(s);
    } catch (err) {
      stats.set(null);
    }
  }

  effect(() => {
    const s = stats();
    statsRegion.replaceChildren();
    if (!s) return;
    const head = h("div", {}, `In ${s.present} of ${s.total} events`);
    head.className = "muted";
    const table = h("table", {});
    const thead = h("thead", {});
    const headRow = h("tr", {});
    for (const c of ["Value", "Count", "Share"]) headRow.append(h("th", {}, c));
    thead.append(headRow);
    const tbody = h("tbody", {});
    table.setAttribute("aria-label", "Top values");
    for (const t of s.top) {
      const tr = h("tr", {});
      tr.append(h("td", { class: "mono" }, t.value), h("td", { class: "mono" }, String(t.count)), h("td", { class: "mono" }, `${t.share}%`));
      const include = h("button", { class: "btn", "aria-label": `Include ${t.value}` }, "+");
      const exclude = h("button", { class: "btn", "aria-label": `Exclude ${t.value}` }, "-");
      include.style.minWidth = "44px";
      exclude.style.minWidth = "44px";
      const tdActions = h("td", {});
      tdActions.append(include, exclude);
      tr.append(tdActions);
      include.addEventListener("click", () => {
        filters.set([...filters(), { field: s.field, op: "eq", value: t.value }]);
        void runSearch();
      });
      exclude.addEventListener("click", () => {
        filters.set([...filters(), { field: s.field, op: "ne", value: t.value }]);
        void runSearch();
      });
      tbody.append(tr);
    }
    table.append(thead, tbody);
    statsRegion.append(head, table);
  });

  // ---------- Grid ----------
  const toolbar = h("div", { class: "grid-toolbar" });
  toolbar.style.display = "flex";
  toolbar.style.gap = "8px";
  toolbar.style.marginTop = "10px";
  toolbar.style.alignItems = "center";
  const liveTailBtn = h("button", { class: "btn" }, "Live tail");
  const saveSearchBtn = h("button", { class: "btn" }, "Save search");
  const columnsBtn = h("button", { class: "btn" }, "Columns");
  const filtersBtn = h("button", { class: "btn" }, "Filters");
  filtersBtn.style.display = "none";
  const newEventsBtn = h("button", { class: "btn-main", "aria-label": "Show new events" }, "Show new events");
  newEventsBtn.style.display = "none";
  toolbar.append(liveTailBtn, saveSearchBtn, columnsBtn, filtersBtn, newEventsBtn);

  const gridHolder = h("div", {});
  const errorsHolder = h("div", {});

  const grid = h("div", { role: "grid", "aria-label": "Events", class: "events-grid" });
  grid.style.background = "var(--surface)";
  grid.style.border = "1px solid var(--hairline)";
  grid.style.borderRadius = "4px";
  grid.style.overflow = "auto";
  grid.style.maxHeight = "60vh";

  const gridTable = h("div", { role: "rowgroup", class: "grid-body" });
  const headerRow = h("div", { role: "row", "aria-rowindex": "1" });
  headerRow.style.display = "flex";
  headerRow.style.position = "sticky";
  headerRow.style.top = "0";
  headerRow.style.background = "var(--surface)";
  headerRow.style.zIndex = "2";
  headerRow.style.borderBottom = "2px solid var(--ink)";

  const columnWidths = new Map<string, number>();

  function widthOf(col: string): number {
    return columnWidths.get(col) ?? (col === "message" ? 480 : 160);
  }

  function rebuildHeader(): void {
    headerRow.replaceChildren();
    for (const col of columns()) {
      const cell = h("div", { role: "columnheader", "aria-colindex": String(columns().indexOf(col) + 1) });
      cell.dataset.width = String(widthOf(col));
      cell.style.width = `${widthOf(col)}px`;
      cell.style.minWidth = `${widthOf(col)}px`;
      cell.style.display = "flex";
      cell.style.alignItems = "center";
      const sortBtn = h("button", { class: "mono", "aria-label": `Sort by ${col}` }, col);
      sortBtn.style.flex = "1";
      sortBtn.style.textAlign = "left";
      sortBtn.style.padding = "6px 8px";
      sortBtn.style.background = "transparent";
      sortBtn.style.border = "none";
      sortBtn.style.fontSize = "12px";
      sortBtn.style.minHeight = "36px";
      sortBtn.addEventListener("click", () => {
        const cur = sort();
        const nextDir = cur?.field === col && cur.dir === "desc" ? "asc" : "desc";
        sort.set({ field: col, dir: nextDir });
        void runSearch();
      });
      const sep = h("div", { role: "separator", "aria-label": `Resize ${col}`, class: "resize" });
      sep.style.width = "6px";
      sep.style.height = "24px";
      sep.style.cursor = "col-resize";
      sep.style.background = "var(--hairline)";
      let startX = 0;
      let startW = 0;
      sep.addEventListener("pointerdown", (e) => {
        startX = e.clientX;
        startW = widthOf(col);
        const move = (ev: PointerEvent): void => {
          const w = Math.max(60, startW + (ev.clientX - startX));
          columnWidths.set(col, w);
          cell.dataset.width = String(w);
          cell.style.width = `${w}px`;
          cell.style.minWidth = `${w}px`;
          for (const row of Array.from(gridTable.querySelectorAll<HTMLElement>("[role=row]"))) {
            const cells = Array.from(row.querySelectorAll<HTMLElement>("[role=gridcell]"));
            const idx = columns().indexOf(col);
            const target = cells[idx];
            if (target) {
              target.style.width = `${w}px`;
              target.style.minWidth = `${w}px`;
            }
          }
        };
        const up = (): void => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      cell.append(sortBtn, sep);
      headerRow.append(cell);
    }
  }

  effect(() => {
    columns();
    rebuildHeader();
  });

  const ROWS_IN_PAGE = 60;
  const visibleStart = signal<number>(0);

  function cellText(e: FlattenedEvent, col: string): string {
    if (col === "@timestamp") return displayIso(e["@timestamp"]);
    const v = e.fields[col];
    if (v === undefined || v === null) return "";
    return Array.isArray(v) ? v.join(", ") : String(v);
  }

  function highlightsOf(e: FlattenedEvent, col: string): [number, number][] {
    return e.highlights?.[col] ?? [];
  }

  function renderMessageCell(e: FlattenedEvent, col: string): HTMLElement {
    const raw = cellText(e, col);
    const hl = highlightsOf(e, col);
    if (hl.length === 0) {
      return document.createTextNode(raw) as unknown as HTMLElement;
    }
    const span = document.createElement("span");
    let pos = 0;
    const sorted = [...hl].sort((a, b) => a[0] - b[0]);
    for (const [start, end] of sorted) {
      if (start < pos || end > raw.length) continue;
      span.append(raw.slice(pos, start));
      const mark = document.createElement("mark");
      mark.textContent = raw.slice(start, end);
      span.append(mark);
      pos = end;
    }
    span.append(raw.slice(pos));
    return span;
  }

  let focusedCell = { row: 0, col: 0 };

  function buildRow(e: FlattenedEvent, index: number): HTMLElement {
    const row = h("div", { role: "row", "aria-rowindex": String(index + 2), class: "grid-row", tabindex: "-1" });
    row.dataset.eventId = e._id;
    row.style.display = "flex";
    row.style.borderBottom = "1px solid var(--hairline)";
    const ts = Date.parse(e["@timestamp"]);
    const host = e.fields.host ?? "none";
    const level = e.fields.level ?? "none";
    row.setAttribute(
      "aria-label",
      `Event ${index + 1} of ${total()}, ${formatInZone(timeZone(), ts)}, ${String(host)}, ${String(level)}`,
    );
    if (e._phase === "archive") row.setAttribute("data-source", "archive");
    columns().forEach((col, ci) => {
      const cell = h("div", { role: "gridcell", tabindex: "-1" });
      cell.style.width = `${widthOf(col)}px`;
      cell.style.minWidth = `${widthOf(col)}px`;
      cell.style.padding = "6px 8px";
      cell.style.fontSize = "12px";
      cell.style.fontFamily = "var(--mono)";
      cell.style.overflow = "hidden";
      cell.style.textOverflow = "ellipsis";
      cell.style.whiteSpace = "nowrap";
      if (col === "@timestamp") {
        cell.textContent = displayIso(e["@timestamp"]);
      } else {
        cell.append(renderMessageCell(e, col));
      }
      row.append(cell);
    });
    row.addEventListener("click", () => {
      focusedCell = { row: index, col: focusedCell.col };
      void openDocument(e, row);
    });
    return row;
  }

  effect(() => {
    const list = events();
    const start = visibleStart();
    const window = list.slice(start, start + ROWS_IN_PAGE);
    gridTable.replaceChildren(...window.map((e, i) => buildRow(e, start + i)));
    grid.setAttribute("aria-rowcount", String(total() + 1));
    grid.setAttribute("data-search-state", searchState());
  });

  // grid keyboard interaction: one tab stop, roving cell
  grid.tabIndex = 0;
  grid.addEventListener("keydown", (e) => {
    const list = events();
    if (list.length === 0) return;
    const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", "Tab", "F6"];
    if (!keys.includes(e.key)) return;
    if (e.key === "Tab") return;
    if (e.key === "Enter") {
      e.preventDefault();
      const rowEl = gridTable.children[focusedCell.row] as HTMLElement | undefined;
      const ev = list[focusedCell.row];
      if (ev && rowEl) void openDocument(ev, rowEl);
      return;
    }
    if (e.key === "F6") return;
    e.preventDefault();
    let { row, col } = focusedCell;
    switch (e.key) {
      case "ArrowDown":
        row = Math.min(list.length - 1, row + 1);
        break;
      case "ArrowUp":
        row = Math.max(0, row - 1);
        break;
      case "ArrowLeft":
        if (e.altKey) {
          const c = columns()[col];
          columnWidths.set(c, Math.max(60, widthOf(c) - 16));
          rebuildHeader();
          for (const r of Array.from(gridTable.querySelectorAll<HTMLElement>("[role=row]"))) {
            const cells = Array.from(r.querySelectorAll<HTMLElement>("[role=gridcell]"));
            const cell = cells[col];
            if (cell) {
              cell.style.width = `${widthOf(c)}px`;
              cell.style.minWidth = `${widthOf(c)}px`;
            }
          }
          return;
        }
        col = Math.max(0, col - 1);
        break;
      case "ArrowRight":
        if (e.altKey) {
          const c = columns()[col];
          columnWidths.set(c, widthOf(c) + 16);
          rebuildHeader();
          for (const r of Array.from(gridTable.querySelectorAll<HTMLElement>("[role=row]"))) {
            const cells = Array.from(r.querySelectorAll<HTMLElement>("[role=gridcell]"));
            const cell = cells[col];
            if (cell) {
              cell.style.width = `${widthOf(c)}px`;
              cell.style.minWidth = `${widthOf(c)}px`;
            }
          }
          return;
        }
        col = Math.min(columns().length - 1, col + 1);
        break;
      case "Home":
        row = 0;
        break;
      case "End":
        row = list.length - 1;
        break;
      case "PageUp":
        row = Math.max(0, row - 20);
        break;
      case "PageDown":
        row = Math.min(list.length - 1, row + 20);
        break;
    }
    focusedCell = { row, col };
    // rows are added to the page as focus moves
    const start = Math.floor(row / ROWS_IN_PAGE) * ROWS_IN_PAGE;
    if (start !== visibleStart()) visibleStart.set(start);
    const cellEl = (gridTable.children[row] as HTMLElement | undefined)?.querySelectorAll<HTMLElement>("[role=gridcell]")[col];
    if (cellEl) cellEl.focus();
  });
  grid.addEventListener("focusin", () => {
    const cellEl = (gridTable.children[focusedCell.row] as HTMLElement | undefined)?.querySelectorAll<HTMLElement>("[role=gridcell]")[focusedCell.col];
    if (cellEl && document.activeElement === grid) cellEl.focus();
  });
  gridTable.addEventListener("keydown", (e) => {
    // delegate cell keys back to the grid handler
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter"].includes(e.key)) {
      grid.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, altKey: e.altKey, cancelable: true }));
      e.preventDefault();
    }
  });

  grid.append(headerRow, gridTable);
  gridHolder.append(grid);

  // ---------- Document panel ----------
  const docPanel = h("aside", { role: "region", "aria-label": "Document", class: "doc-panel" });
  docPanel.style.display = "none";
  docPanel.style.border = "1px solid var(--border)";
  docPanel.style.borderBottom = "3px solid var(--ink)";
  docPanel.style.borderRadius = "4px";
  docPanel.style.background = "var(--paper)";
  docPanel.style.padding = "14px";
  docPanel.style.overflow = "auto";
  docPanel.style.maxHeight = "70vh";
  docPanel.style.width = "380px";
  docPanel.style.flexShrink = "0";

  let docOpener: HTMLElement | null = null;

  async function openDocument(e: FlattenedEvent, opener: HTMLElement): Promise<void> {
    docOpener = opener;
    documentEvent.set(e);
    docPanel.style.display = "block";
    animate(docPanel, "panel-in", [
      { transform: "translateX(16px)", opacity: "0" },
      { transform: "translateX(0)", opacity: "1" },
    ], { duration: 160, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)", fill: "forwards" });
    renderDocument();
    try {
      const res = await api<{ before: FlattenedEvent[]; event: FlattenedEvent; after: FlattenedEvent[] }>(
        `/api/streams/${encodeURIComponent(streamName())}/events/${encodeURIComponent(e._id)}/surrounding`,
      );
      surrounding.set([...res.before, res.event, ...res.after]);
    } catch {
      surrounding.set([e]);
    }
    if (queryText().trim() !== "") {
      try {
        const res = await api<{ events: (FlattenedEvent & { explanation?: { value: number; text: string; children: { text: string }[] } })[] }>(
          `/api/search?stream=${encodeURIComponent(streamName())}&q=${encodeURIComponent(queryText())}&from=${new Date(fromMs()).toISOString()}&to=${new Date(toMs()).toISOString()}&explain=true&id=${encodeURIComponent(e._id)}`,
        );
        const found = res.events.find((x) => x._id === e._id);
        if (found?.explanation) explain.set(found.explanation);
        else explain.set(null);
      } catch {
        explain.set(null);
      }
    } else {
      explain.set(null);
    }
    renderDocument();
    const closeBtn = docPanel.querySelector<HTMLElement>('[aria-label="Close document"]');
    if (closeBtn) closeBtn.focus();
  }

  function closeDocument(): void {
    docPanel.style.display = "none";
    documentEvent.set(null);
    explain.set(null);
    surrounding.set([]);
    if (docOpener) docOpener.focus();
  }

  docPanel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeDocument();
    }
  });

  function renderDocument(): void {
    const e = documentEvent();
    if (!e) {
      docPanel.replaceChildren();
      return;
    }
    docPanel.replaceChildren();
    const closeBtn = h("button", { class: "btn", "aria-label": "Close document" }, "Close");
    closeBtn.addEventListener("click", closeDocument);
    const surroundBtn = h("button", { class: "btn", "aria-label": "Surrounding events" }, "Surrounding events");
    const explainBtn = h("button", { class: "btn", "aria-label": "Explain score" }, "Explain score");
    if (!queryText().trim()) explainBtn.style.display = "none";
    const editBtn = h("button", { class: "btn", "aria-label": "Edit event" }, "Edit event");
    const actions = h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } });
    actions.append(closeBtn, surroundBtn, explainBtn, editBtn);
    docPanel.append(actions);

    const pre = h("pre", { class: "mono" });
    pre.style.fontSize = "12px";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.wordBreak = "break-all";
    pre.style.margin = "10px 0";
    pre.textContent = JSON.stringify({ _id: e._id, "@timestamp": e["@timestamp"], ...e.fields }, null, 2);
    docPanel.append(pre);

    // Surrounding events table
    const surHead = h("h3", {}, "Surrounding events");
    const surTable = h("table", { "aria-label": "Surrounding events" });
    for (const s of surrounding()) {
      const tr = h("tr", {});
      const ts = h("td", { class: "mono" }, displayIso(s["@timestamp"]));
      const msg = h("td", { class: "mono" }, String(s.fields.message ?? ""));
      const id = h("td", { class: "mono" }, s._id);
      if (s._id === e._id) tr.setAttribute("aria-current", "true");
      tr.append(id, ts, msg);
      surTable.append(tr);
    }
    docPanel.append(surHead, surTable);

    // Score explanation
    const ex = explain();
    if (ex) {
      const exHead = h("h3", {}, "Score explanation");
      const tree = h("div", { role: "tree", "aria-label": "Score explanation" });
      const root = h("div", { role: "treeitem", "aria-level": "1" }, ex.text);
      root.className = "mono";
      root.style.padding = "4px 0";
      const children = h("div", { role: "group" });
      for (const c of ex.children) {
        const item = h("div", { role: "treeitem", "aria-level": "2", class: "mono" }, c.text);
        item.style.paddingLeft = "16px";
        item.style.fontSize = "12px";
        children.append(item);
      }
      tree.append(root, children);
      docPanel.append(exHead, tree);
    }

    explainBtn.addEventListener("click", () => {
      const res = docPanel.querySelector('[role="tree"]');
      if (res) res.scrollIntoView();
    });
    surroundBtn.addEventListener("click", () => {
      surTable.scrollIntoView();
    });
    editBtn.addEventListener("click", () => openEditEvent(e));
  }

  function openEditEvent(e: FlattenedEvent): void {
    openModal(
      (close) => {
        const box = h("div", {});
        const label = h("label", { for: "fields-json" }, "Fields JSON");
        const textarea = document.createElement("textarea");
        textarea.id = "fields-json";
        textarea.className = "input mono";
        textarea.setAttribute("aria-label", "Fields JSON");
        textarea.rows = 10;
        textarea.value = JSON.stringify(e.fields, null, 2);
        const save = h("button", { class: "btn-main" }, "Save event");
        const error = h("div", { class: "error-box", role: "alert", "aria-label": "Error" });
        error.style.display = "none";
        save.addEventListener("click", async () => {
          save.setAttribute("aria-busy", "true");
          try {
            const fields = JSON.parse(textarea.value);
            await api(`/api/streams/${encodeURIComponent(streamName())}/events/${encodeURIComponent(e._id)}`, {
              method: "PATCH",
              body: JSON.stringify({ fields }),
              headers: { "Content-Type": "application/json" },
            });
            showNotice("Event saved.");
            close();
            void runSearch();
          } catch (err) {
            if (err instanceof ApiFail) {
              error.style.display = "block";
              error.textContent = err.body.message;
            } else {
              error.style.display = "block";
              error.textContent = "Check the highlighted fields.";
            }
          } finally {
            save.removeAttribute("aria-busy");
          }
        });
        const cancel = h("button", { class: "btn" }, "Cancel");
        cancel.addEventListener("click", close);
        const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
        row.append(save, cancel);
        box.append(h("h3", {}, "Edit event"), label, textarea, error, row);
        return box;
      },
      null,
      "Edit event",
    );
  }

  // ---------- Search ----------
  async function runSearch(): Promise<void> {
    await runSearchWithAnnouncement((n) => `${n} ${n === 1 ? "event" : "events"} found`);
  }

  async function runSearchWithAnnouncement(sentence: (n: number) => string): Promise<void> {
    await refreshTime();
    searchState.set("loading");
    searchError.set("");
    queryError.set(null);
    snapshotExpired.set(false);
    partialResults.set(null);
    try {
      const sortParam = sort() ? `${sort()!.field}:${sort()!.dir}` : undefined;
      const params = new URLSearchParams();
      params.set("stream", streamName());
      if (queryText().trim()) params.set("q", queryText());
      params.set("from", new Date(fromMs()).toISOString());
      params.set("to", new Date(toMs()).toISOString());
      const active = filters().filter((f) => !f.disabled);
      if (active.length > 0) params.set("filters", JSON.stringify(active));
      if (sortParam) params.set("sort", sortParam);
      // Use a snapshot so paging is stable
      const snap = await api<{ id: string; total: number; partial: boolean; skipped_generations: number; events: FlattenedEvent[] }>(
        "/api/snapshots",
        {
          method: "POST",
          body: JSON.stringify({
            stream: streamName(),
            from: new Date(fromMs()).toISOString(),
            to: new Date(toMs()).toISOString(),
            q: queryText(),
            filters: active,
            sort: sortParam ?? null,
          }),
          headers: { "Content-Type": "application/json" },
        },
      );
      snapshotId.set(snap.id);
      total.set(snap.total);
      const page = await api<{ events: FlattenedEvent[]; next: string | null; new_events: number }>(
        `/api/snapshots/${snap.id}?after=0`,
      );
      events.set(page.events);
      visibleStart.set(0);
      newEvents.set(page.new_events);
      searchState.set("done");
      announce(sentence(snap.total));
      if (snap.partial) partialResults.set({ skipped: snap.skipped_generations });
      await Promise.all([loadHistogram(), loadFields(), loadStats()]);
    } catch (err) {
      searchState.set("error");
      if (err instanceof ApiFail) {
        if (err.body.error === "snapshot_expired") {
          snapshotExpired.set(true);
        } else if (err.body.position !== undefined) {
          queryError.set({ message: err.body.message, position: err.body.position });
          queryInput.focus();
          queryInput.setSelectionRange(err.body.position - 1, err.body.position - 1);
        } else {
          searchError.set(err.body.message);
        }
      } else {
        searchError.set("Spoorline can't reach the server. Retry when your connection is back.");
      }
    }
  }

  async function loadHistogram(): Promise<void> {
    try {
      const res = await api<{ interval: string; buckets: { start: string; end: string; count: number; label: string }[] }>(
        `/api/histogram?stream=${encodeURIComponent(streamName())}${queryText() ? `&q=${encodeURIComponent(queryText())}` : ""}&from=${new Date(fromMs()).toISOString()}&to=${new Date(toMs()).toISOString()}&tz=${encodeURIComponent(timeZone())}`,
      );
      interval.set(res.interval);
      buckets.set(res.buckets.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end), count: b.count, label: b.label })));
    } catch {
      // keep the old histogram
    }
  }

  async function loadFields(): Promise<void> {
    try {
      const res = await api<{ fields: FieldInfo[] }>(
        `/api/fields?stream=${encodeURIComponent(streamName())}&from=${new Date(fromMs()).toISOString()}&to=${new Date(toMs()).toISOString()}`,
      );
      fields.set(res.fields);
    } catch {
      fields.set([]);
    }
  }

  // ---------- Live tail ----------
  const tailHolder = h("div", {});
  let tailAbort: (() => void) | null = null;
  let tailPaused = false;
  let tailBuffer: FlattenedEvent[] = [];
  let tailDiscarded = 0;
  let tailPausedCount = 0;
  let tailLines: FlattenedEvent[] = [];

  liveTailBtn.addEventListener("click", () => {
    if (tailAbort) {
      tailAbort();
      tailAbort = null;
      gridHolder.style.display = "block";
      tailHolder.replaceChildren();
      liveTailBtn.textContent = "Live tail";
      return;
    }
    startTail();
  });

  function startTail(): void {
    gridHolder.style.display = "none";
    liveTailBtn.textContent = "Stop tail";
    const region = h("div", { role: "region", "aria-label": "Live tail", class: "card" });
    region.style.maxHeight = "60vh";
    region.style.overflow = "auto";
    const controls = h("div", { style: { display: "flex", gap: "8px", marginBottom: "8px" } });
    const pauseBtn = h("button", { class: "btn" }, "Pause");
    const status = h("div", { class: "muted mono" });
    const lines = h("div", { class: "mono" });
    lines.style.fontSize = "12px";
    lines.style.display = "flex";
    lines.style.flexDirection = "column";
    controls.append(pauseBtn, status);
    region.append(controls, lines);
    tailHolder.replaceChildren(region);
    tailLines = [];
    tailPaused = false;
    tailBuffer = [];
    tailDiscarded = 0;
    tailPausedCount = 0;

    const bufferMax = (window as unknown as { settings: { tail_buffer: number } }).settings?.tail_buffer ?? 50;
    const es = new EventSource(`/api/tail?stream=${encodeURIComponent(streamName())}`);
    tailAbort = () => {
      es.close();
      es.onmessage = null;
    };
    es.addEventListener("line", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as FlattenedEvent;
      if (tailPaused) {
        tailPausedCount += 1;
        tailBuffer.push(data);
        if (tailBuffer.length > bufferMax) {
          tailDiscarded += tailBuffer.length - bufferMax;
          tailBuffer = tailBuffer.slice(-bufferMax);
        }
        announce(`Live tail paused: ${tailPausedCount} ${tailPausedCount === 1 ? "new event" : "new events"}`);
        renderTailStatus();
        return;
      }
      tailLines.push(data);
      lines.append(
        Object.assign(document.createElement("div"), {
          textContent: `${displayIso(data["@timestamp"])} ${String(data.fields.host ?? "")} ${String(data.fields.level ?? "")} ${String(data.fields.message ?? "")}`,
        }),
      );
      region.scrollTop = region.scrollHeight;
    });
    es.addEventListener("slowed", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { skipped: number };
      status.textContent = "Live tail slowed: rate limit reached.";
    });

    function renderTailStatus(): void {
      if (tailPaused) {
        const parts = [`Live tail paused: ${tailPausedCount} ${tailPausedCount === 1 ? "new event" : "new events"}`];
        if (tailDiscarded > 0) {
          parts.push(`Buffer full: oldest ${tailDiscarded} ${tailDiscarded === 1 ? "event" : "events"} discarded.`);
        }
        status.textContent = parts.join(" ");
      } else {
        status.textContent = "";
      }
    }

    pauseBtn.addEventListener("click", () => {
      if (!tailPaused) {
        tailPaused = true;
        tailPausedCount = 0;
        tailDiscarded = 0;
        tailBuffer = [];
        pauseBtn.textContent = "Resume";
        announce(`Live tail paused: 0 new events`);
        renderTailStatus();
      } else {
        tailPaused = false;
        pauseBtn.textContent = "Pause";
        for (const e of tailBuffer) {
          tailLines.push(e);
          lines.append(
            Object.assign(document.createElement("div"), {
              textContent: `${displayIso(e["@timestamp"])} ${String(e.fields.host ?? "")} ${String(e.fields.level ?? "")} ${String(e.fields.message ?? "")}`,
            }),
          );
        }
        tailBuffer = [];
        status.textContent = "";
      }
    });
    region.addEventListener("scroll", () => {
      if (!tailPaused && region.scrollTop === 0 && tailLines.length > 0) {
        pauseBtn.click();
      }
    });
  }

  // ---------- New events ----------
  effect(() => {
    const n = newEvents();
    if (n > 0) {
      newEventsBtn.style.display = "inline-flex";
      newEventsBtn.textContent = `${n} new ${n === 1 ? "event" : "events"} since this search`;
      newEventsBtn.setAttribute("aria-label", "Show new events");
    } else {
      newEventsBtn.style.display = "none";
    }
  });
  newEventsBtn.addEventListener("click", () => {
    void runSearch();
  });

  addLiveHandler("upload", (data) => {
    if (snapshotId()) {
      void refreshNewEvents();
    }
  });

  async function refreshNewEvents(): Promise<void> {
    const id = snapshotId();
    if (!id) return;
    try {
      const res = await api<{ new_events: number }>(`/api/snapshots/${id}?after=0`);
      newEvents.set(res.new_events);
    } catch (err) {
      if (err instanceof ApiFail && err.body.error === "snapshot_expired") {
        snapshotExpired.set(true);
      }
    }
  }

  addLiveHandler("upload", (data) => {
    if (data.ended) void refreshNewEvents();
  });

  // ---------- Columns dialog ----------
  columnsBtn.addEventListener("click", () => {
    openModal(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "Columns"));
        const known = new Set<string>(["@timestamp", "host", "level", "message"]);
        for (const f of fields()) known.add(f.field);
        for (const col of known) {
          const row = h("label", { style: { display: "block", padding: "6px 0" } });
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.setAttribute("aria-label", col);
          cb.checked = columns().includes(col);
          cb.addEventListener("change", () => {
            const list = [...columns()];
            if (cb.checked) {
              if (!list.includes(col)) list.push(col);
            } else {
              const idx = list.indexOf(col);
              if (idx >= 0 && list.length > 1) list.splice(idx, 1);
            }
            columns.set(list);
            rebuildHeader();
          });
          row.append(cb, document.createTextNode(" " + col));
          box.append(row);
        }
        const done = h("button", { class: "btn-main" }, "Done");
        done.addEventListener("click", close);
        box.append(done);
        return box;
      },
      columnsBtn,
      "Columns",
    );
  });

  // ---------- Save search ----------
  saveSearchBtn.addEventListener("click", () => {
    openModal(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "Save search"));
        const name = document.createElement("input");
        name.className = "input";
        name.setAttribute("aria-label", "Search name");
        name.placeholder = "Search name";
        const save = h("button", { class: "btn-main" }, "Save");
        const cancel = h("button", { class: "btn" }, "Cancel");
        cancel.addEventListener("click", close);
        save.addEventListener("click", async () => {
          save.setAttribute("aria-busy", "true");
          try {
            await api("/api/saved-searches", {
              method: "POST",
              body: JSON.stringify({
                name: name.value,
                stream: streamName(),
                q: queryText(),
                filters: filters(),
                from: new Date(fromMs()).toISOString(),
                to: new Date(toMs()).toISOString(),
              }),
              headers: { "Content-Type": "application/json" },
            });
            showNotice(`Search ${name.value} saved.`);
            close();
          } catch (err) {
            if (err instanceof ApiFail) {
              showNotice(err.body.message);
            }
          } finally {
            save.removeAttribute("aria-busy");
          }
        });
        const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
        row.append(save, cancel);
        box.append(name, row);
        return box;
      },
      saveSearchBtn,
      "Save search",
    );
  });

  // ---------- Time range dialog ----------
  rangeButton.addEventListener("click", () => {
    const build = (close: () => void): HTMLElement => {
      const box = h("div", {});
      const tabs = h("div", { role: "tablist", "aria-label": "Range kind" });
      tabs.style.display = "flex";
      tabs.style.gap = "4px";
      tabs.style.marginBottom = "10px";
      const panels: Record<string, HTMLElement> = {};
      let active = "Quick";
      const tabRefs: Record<string, HTMLElement> = {};
      const tabPanels: Record<string, HTMLElement> = {};
      const switchTo = (kind: string): void => {
        active = kind;
        for (const [k, btn] of Object.entries(tabRefs)) {
          if (k === kind) {
            btn.setAttribute("aria-selected", "true");
            btn.setAttribute("tabindex", "0");
            btn.style.borderBottom = "2px solid var(--accent)";
            btn.style.color = "var(--accent)";
            tabPanels[k].style.display = "block";
          } else {
            btn.setAttribute("aria-selected", "false");
            btn.setAttribute("tabindex", "-1");
            btn.style.borderBottom = "2px solid transparent";
            btn.style.color = "var(--ink)";
            tabPanels[k].style.display = "none";
          }
        }
      };
      for (const kind of ["Quick", "Relative", "Absolute"]) {
        const tab = h("button", { role: "tab", "aria-label": kind }, kind) as HTMLElement;
        tab.style.padding = "8px 12px";
        tab.style.minHeight = "40px";
        tab.style.background = "transparent";
        tab.style.border = "none";
        tab.addEventListener("click", () => switchTo(kind));
        tabs.append(tab);
        tabRefs[kind] = tab;
        const panel = h("div", { role: "tabpanel" });
        tabPanels[kind] = panel;
        box.append(panel);
      }
      box.prepend(tabs);
      // Quick
      const quickOptions: [string, number][] = [
        ["Last 15 minutes", 900000],
        ["Last 1 hour", 3600000],
        ["Last 24 hours", 86400000],
        ["Last 7 days", 604800000],
      ];
      let quickMs = 900000;
      for (const [label, ms] of quickOptions) {
        const row = h("label", { style: { display: "block", padding: "6px 0" } });
        const rb = document.createElement("input");
        rb.type = "radio";
        rb.name = "quick";
        rb.setAttribute("aria-label", label);
        rb.addEventListener("change", () => {
          quickMs = ms;
        });
        row.append(rb, document.createTextNode(" " + label));
        tabPanels["Quick"].append(row);
      }
      // Relative
      const amount = document.createElement("input");
      amount.className = "input";
      amount.setAttribute("aria-label", "Amount");
      amount.type = "number";
      amount.value = "15";
      const unit = h("select", { class: "input", "aria-label": "Unit" }) as HTMLSelectElement;
      for (const u of ["minutes", "seconds", "hours", "days", "weeks"]) {
        const o = document.createElement("option");
        o.value = u;
        o.textContent = u;
        unit.append(o);
      }
      const relRow = h("div", { style: { display: "flex", gap: "6px" } });
      relRow.append(amount, unit);
      tabPanels["Relative"].append(relRow);
      // Absolute
      const fromInput = document.createElement("input");
      fromInput.className = "input mono";
      fromInput.setAttribute("aria-label", "From");
      fromInput.placeholder = "YYYY-MM-DD HH:MM:SS";
      const toInput = document.createElement("input");
      toInput.className = "input mono";
      toInput.setAttribute("aria-label", "To");
      toInput.placeholder = "YYYY-MM-DD HH:MM:SS";
      tabPanels["Absolute"].append(fromInput, toInput);
      const error = h("div", { class: "error-box", role: "alert", "aria-label": "Error" });
      error.style.display = "none";
      const apply = h("button", { class: "btn-main" }, "Apply");
      const cancel = h("button", { class: "btn" }, "Cancel");
      cancel.addEventListener("click", close);
      apply.addEventListener("click", () => {
        error.style.display = "none";
        if (active === "Quick") {
          fromMs.set(serverNow() - quickMs);
          toMs.set(serverNow());
        } else if (active === "Relative") {
          const n = Number(amount.value);
          const unitMs: Record<string, number> = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };
          fromMs.set(serverNow() - n * (unitMs[unit.value] ?? 60000));
          toMs.set(serverNow());
        } else {
          const zone = timeZone();
          const f = parseWallTime(zone, fromInput.value);
          const t = parseWallTime(zone, toInput.value);
          if (!f.ok || !t.ok) {
            error.style.display = "block";
            error.textContent = "Enter a time as YYYY-MM-DD HH:MM:SS.";
            return;
          }
          if (f.exists === false) {
            error.style.display = "block";
            error.textContent = `That time doesn't exist in ${zone}.`;
            return;
          }
          if (t.exists === false) {
            error.style.display = "block";
            error.textContent = `That time doesn't exist in ${zone}.`;
            return;
          }
          if ((f.ms ?? 0) >= (t.ms ?? 0)) {
            error.style.display = "block";
            error.textContent = "From must be before To.";
            return;
          }
          fromMs.set(f.ms!);
          toMs.set(t.ms!);
        }
        syncAddress();
        close();
        void runSearch();
      });
      const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "12px" } });
      row.append(apply, cancel);
      box.append(error, row);
      switchTo("Quick");
      return box;
    };
    openSheet(build, rangeButton, "Time range");
  });

  // ---------- F6 region moves ----------
  function focusRegion(name: string): void {
    if (name === "query") queryInput.focus();
    else if (name === "histogram") focusBucket();
    else if (name === "fields") {
      const first = fieldList.querySelector<HTMLElement>("button");
      if (first) first.focus();
    } else if (name === "grid") {
      const cellEl = (gridTable.children[focusedCell.row] as HTMLElement | undefined)?.querySelectorAll<HTMLElement>("[role=gridcell]")[focusedCell.col];
      if (cellEl) cellEl.focus();
      else grid.focus();
    } else if (name === "document") {
      const closeBtn = docPanel.querySelector<HTMLElement>('[aria-label="Close document"]');
      if (closeBtn) closeBtn.focus();
    }
  }

  view.addEventListener("keydown", (e) => {
    if (e.key !== "F6") return;
    e.preventDefault();
    const order = [...F6_REGIONS] as (typeof F6_REGIONS)[number][];
    if (!documentEvent()) order.pop();
    const current = order.indexOf(activeRegion() as (typeof F6_REGIONS)[number]);
    const next = e.shiftKey ? (current - 1 + order.length) % order.length : (current + 1) % order.length;
    focusRegion(order[next]);
  });

  function activeRegion(): string {
    const el = document.activeElement;
    if (!el) return "query";
    if (queryInput.contains(el) || el === queryInput) return "query";
    if (histogram.contains(el)) return "histogram";
    if (fieldList.contains(el) || statsRegion.contains(el)) return "fields";
    if (docPanel.contains(el)) return "document";
    return "grid";
  }

  // ---------- Layout ----------
  const content = h("div", { class: "explore-content" });
  const leftCol = h("div", { class: "explore-fields" });
  const rightCol = h("div", { class: "explore-main" });
  const phoneEvents = h("div", { role: "list", "aria-label": "Events", class: "phone-events" });
  phoneEvents.style.display = "none";

  effect(() => {
    const band = layoutBand();
    if (band === "phone") {
      content.style.display = "block";
      leftCol.style.display = "none";
      phoneEvents.style.display = "block";
      gridHolder.style.display = tailAbort ? "none" : "none";
      filtersBtn.style.display = "inline-flex";
      docPanel.style.width = "100%";
      docPanel.style.position = "fixed";
      docPanel.style.inset = "80px 0 0 0";
      docPanel.style.zIndex = "80";
      docPanel.style.maxHeight = "none";
    } else {
      content.style.display = "flex";
      content.style.gap = "12px";
      leftCol.style.display = "block";
      leftCol.style.width = "20%";
      leftCol.style.flexShrink = "0";
      phoneEvents.style.display = "none";
      gridHolder.style.display = tailAbort ? "none" : "block";
      filtersBtn.style.display = "none";
      docPanel.style.position = "static";
      docPanel.style.width = "380px";
      docPanel.style.inset = "auto";
      docPanel.style.zIndex = "auto";
      docPanel.style.maxHeight = "70vh";
    }
  });

  effect(() => {
    const list = events();
    if (layoutBand() !== "phone") return;
    phoneEvents.replaceChildren();
    list.slice(visibleStart(), visibleStart() + 40).forEach((e, i) => {
      const card = h("article", {
        role: "listitem",
        "aria-label": `Event ${visibleStart() + i + 1} of ${total()}, ${displayIso(e["@timestamp"])}, ${String(e.fields.host ?? "none")}, ${String(e.fields.level ?? "none")}`,
      });
      card.className = "card";
      card.addEventListener("click", () => void openDocument(e, card));
      const ts = displayIso(e["@timestamp"]);
      card.append(
        Object.assign(document.createElement("div"), { textContent: ts, className: "mono muted" }),
        Object.assign(document.createElement("div"), {
          textContent: `${String(e.fields.host ?? "none")} ${String(e.fields.level ?? "none")}`,
          className: "mono",
        }),
        Object.assign(document.createElement("div"), { textContent: String(e.fields.message ?? ""), className: "mono" }),
      );
      phoneEvents.append(card);
    });
  });

  // Phone Filters sheet
  filtersBtn.addEventListener("click", () => {
    openSheet(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "Filters"));
        box.append(pillRow, fieldList, statsRegion);
        const done = h("button", { class: "btn-main" }, "Done");
        done.addEventListener("click", close);
        box.append(done);
        return box;
      },
      filtersBtn,
      "Filters",
    );
  });

  // ---------- Error surfaces ----------
  effect(() => {
    errorsHolder.replaceChildren();
    if (queryError()) {
      const alert = namedAlert("Query error", queryError()!.message);
      errorsHolder.append(alert);
    }
    if (partialResults()) {
      const s = partialResults()!;
      const status = h("div", { role: "status", class: "error-box" });
      const k = s.skipped;
      status.textContent = `Partial results: ${k} ${k === 1 ? "archived generation" : "archived generations"} skipped because storage is unavailable.`;
      errorsHolder.append(status);
    }
    if (snapshotExpired()) {
      const alert = namedAlert("Snapshot expired", "This snapshot expired. Results may have changed. Start a new search.");
      const start = h("button", { class: "btn-main" }, "Start a new search");
      start.addEventListener("click", () => {
        snapshotExpired.set(false);
        void runSearch();
      });
      alert.append(start);
      errorsHolder.append(alert);
    }
    if (searchState() === "error" && searchError()) {
      const alert = namedAlert("Search failed", searchError());
      const retry = h("button", { class: "btn" }, "Retry");
      retry.addEventListener("click", () => void runSearch());
      alert.append(retry);
      errorsHolder.append(alert);
    }
    if (searchState() === "done" && total() === 0) {
      const widen = h("button", { class: "btn-main" }, "Widen to last 7 days");
      widen.addEventListener("click", () => {
        fromMs.set(serverNow() - 604800000);
        toMs.set(serverNow());
        syncAddress();
        void runSearch();
      });
      errorsHolder.append(emptyBand("No events in this range.", widen));
    }
  });

  effect(() => {
    intervalLabel.textContent = `Interval: ${interval()}`;
    rangeText.textContent = `Showing ${displayTime(fromMs())} to ${displayTime(toMs())}`;
  });

  leftCol.append(fieldList, statsRegion);
  rightCol.append(toolbar, gridHolder, phoneEvents, tailHolder, docPanel);
  content.append(leftCol, rightCol);
  layout.append(bar, pillRow, intervalLabel, histogram, errorsHolder, content);
  view.append(layout);

  // ---------- Streams list and address sync ----------
  effect(() => {
    const list = streams();
    streamCombo.replaceChildren();
    for (const s of list) {
      const o = document.createElement("option");
      o.value = s.name;
      o.textContent = s.name;
      if (s.name === streamName()) o.selected = true;
      streamCombo.append(o);
    }
  });
  streamCombo.addEventListener("change", () => {
    streamName.set(streamCombo.value);
    syncAddress();
    void runSearch();
  });

  async function loadStreams(): Promise<void> {
    try {
      const res = await api<{ streams: StreamSummary[] }>("/api/streams");
      streams.set(res.streams);
      if (!streamName() && res.streams.length > 0) {
        streamName.set(res.streams[0].name);
      }
    } catch {
      streams.set([]);
    }
  }

  async function init(): Promise<void> {
    readAddress();
    await loadStreams();
    if (streams().length === 0) {
      const newStream = h("button", { class: "btn-main" }, "New stream");
      newStream.addEventListener("click", () => navigate("/streams"));
      view.replaceChildren(emptyBand("No events in this range.", newStream));
      return;
    }
    syncAddress();
    await runSearch();
  }

  void init();
}

