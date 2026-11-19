// Styles: filters, sort, search, paging, row menu, catalogue preview — all in the address.

import { announce, api, el, formatQuery, qs, withWorking } from "./api.js";
import type { RouteCtx } from "./app.js";
import { handleSessionEnd, navigate } from "./app.js";
import { STATE_NAMES, UI } from "./copy.js";
import { floatingPanel } from "./overlay.js";

interface StyleRow {
  id: string;
  labelId: string;
  labelName: string;
  styleCode: string | null;
  name: string;
  season: string;
  gtin: string;
  garment: string;
  state: string;
  suppliers: string[];
  climateShown: string | null;
}

interface LabelRow {
  id: string;
  name: string;
  state: string;
  contactName: string;
  contactEmail: string;
}

interface ListOut {
  styles: StyleRow[];
  nextCursor: string | null;
}

export function registerStylesScreen(ctx: RouteCtx): () => void {
  const main = ctx.main;
  const h1 = el("h1", {}, "Styles");
  const refreshLine = el("p", { class: "refresh-line", "data-part": "refresh-line", hidden: "true" }, UI.refreshFailed);

  const filters = el("div", { class: "filters" });
  const labelSel = el("select", { "aria-label": "Label" });
  const seasonSel = el("select", { "aria-label": "Season" });
  const stateSel = el("select", { "aria-label": "State" });
  const sortSel = el("select", { "aria-label": "Sort by" });
  const search = el("input", { type: "search", "aria-label": "Search styles", placeholder: "Search styles" });

  stateSel.append(
    el("option", { value: "" }, "All states"),
    el("option", { value: "draft" }, "Draft"),
    el("option", { value: "worked" }, "Worked"),
    el("option", { value: "published" }, "Published"),
    el("option", { value: "archived" }, "Archived"),
  );
  sortSel.append(el("option", { value: "name" }, "Name"), el("option", { value: "climate" }, "Climate figure"));

  const state = {
    label: ctx.params.get("label") ?? "",
    season: ctx.params.get("season") ?? "",
    state: ctx.params.get("state") ?? "",
    sort: ctx.params.get("sort") ?? "name",
    q: ctx.params.get("q") ?? "",
    cursor: ctx.params.get("cursor") ?? "",
  };
  search.value = state.q;
  stateSel.value = state.state;
  sortSel.value = state.sort;

  const tableFrame = el("div", { class: "table-frame", role: "region", "aria-label": "Styles table", tabindex: "0" });
  const table = el("table");
  const thead = el("thead");
  thead.append(
    (() => {
      const tr = el("tr");
      for (const h of ["Style", "Label", "Season", "State", "Suppliers", "Climate", "Actions"]) {
        tr.append(el("th", {}, h));
      }
      return tr;
    })(),
  );
  const tbody = el("tbody");
  table.append(thead, tbody);
  tableFrame.append(table);

  const nextBtn = el("button", { class: "btn" }, "Next page");
  const newBtn = el("button", { class: "btn btn-primary" }, "New style");
  const catBtn = el("button", { class: "btn" }, "Bring in catalogue");

  filters.append(labelSel, seasonSel, stateSel, sortSel, search);
  const bar = el("div", { class: "bottom-bar" });
  bar.append(newBtn);

  main.append(h1, refreshLine, filters, tableFrame, el("div", { class: "row-controls" }, nextBtn, catBtn), newBtn, bar);

  const queryOf = (): string => {
    const params: Record<string, string> = {};
    if (state.label) params.label = state.label;
    if (state.season) params.season = state.season;
    if (state.state) params.state = state.state;
    if (state.sort) params.sort = state.sort;
    if (state.q) params.q = state.q;
    if (state.cursor) params.cursor = state.cursor;
    return formatQuery(params);
  };

  const addressOf = (): string => `/styles${queryOf()}`;

  async function load(announceCount = true): Promise<void> {
    try {
      const out = await api<ListOut>(`/api/styles${queryOf()}`);
      rememberPage(out);
      refreshLine.hidden = true;
      renderRows(out);
      nextBtn.hidden = out.nextCursor === null;
      if (announceCount) announce(UI.stylesShown(out.styles.length));
    } catch (err) {
      const failure = err as { status?: number };
      if (failure.status === 401) handleSessionEnd();
      else refreshLine.hidden = false;
    }
  }

  function renderRows(out: ListOut): void {
    tbody.textContent = "";
    for (const style of out.styles) {
      const tr = el("tr");
      const nameLink = el("a", { href: `/styles/${style.id}`, class: "style-link" }, style.name);
      nameLink.dataset.styleId = style.id;
      nameLink.dataset.styleName = style.name;
      const actionsBtn = el("button", { class: "btn", "aria-haspopup": "menu" }, `Actions for ${style.name}`);
      tr.append(
        el("td", {}, nameLink),
        el("td", {}, style.labelName),
        el("td", {}, style.season),
        el("td", {}, STATE_NAMES[style.state] ?? style.state),
        el("td", {}, style.suppliers.join(", ")),
        el("td", { class: "num" }, style.climateShown ?? "\u2014"),
        el("td", {}, actionsBtn),
      );
      actionsBtn.addEventListener("click", () => {
        void openRowMenu(actionsBtn, style);
      });
      tbody.append(tr);
    }
  }

  async function openRowMenu(opener: HTMLElement, style: StyleRow): Promise<void> {
    const panel = floatingPanel(opener, (root) => {
      const mk = (label: string, run: () => Promise<void> | void) => {
        const item = el("button", { role: "menuitem" }, label);
        item.addEventListener("click", async () => {
          panel.remove();
          document.removeEventListener("mousedown", onDoc);
          await run();
        });
        root.append(item);
      };
      mk("Open", () => navigate(`/styles/${style.id}`));
      mk("Duplicate", async () => {
        try {
          const out = await api<{ id: string; name: string }>(`/api/styles/${style.id}/duplicate`, { method: "POST" });
          announce(UI.duplicated(out.name));
          navigate(`/styles/${out.id}`);
        } catch (err) {
          announceRowError(err);
        }
      });
      mk("Archive", async () => {
        try {
          await api(`/api/styles/${style.id}/archive`, { method: "POST" });
          announce(UI.archived(style.name));
          await load(false);
        } catch (err) {
          announceRowError(err);
        }
      });
    });
    const onDoc = (e: MouseEvent) => {
      if (!panel.contains(e.target as Node)) {
        panel.remove();
        document.removeEventListener("mousedown", onDoc);
      }
    };
    document.addEventListener("mousedown", onDoc);
    const first = panel.querySelector<HTMLElement>("button");
    first?.focus();
    document.addEventListener("keydown", function onKey(e: KeyboardEvent) {
      if (!document.body.contains(panel)) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (e.key === "Escape") {
        panel.remove();
        opener.focus();
        document.removeEventListener("keydown", onKey);
      }
    });
  }

  function announceRowError(err: unknown): void {
    const failure = err as { message?: string; status?: number };
    if (failure.status === 401) handleSessionEnd();
    else announce(failure.message ?? `Something went wrong.`);
  }

  let lastPage: ListOut | null = null;
  const rememberPage = (out: ListOut): void => {
    lastPage = out;
  };
  nextBtn.addEventListener("click", () => {
    // The cursor continues after the last row shown.
    const cursor = lastPage?.nextCursor;
    if (cursor) {
      state.cursor = cursor;
      history.pushState(null, "", addressOf());
      void load();
    }
  });


  const commit = (): void => {
    state.cursor = "";
    history.pushState(null, "", addressOf());
    void load();
  };

  labelSel.addEventListener("change", () => {
    state.label = labelSel.value;
    commit();
  });
  seasonSel.addEventListener("change", () => {
    state.season = seasonSel.value;
    commit();
  });
  stateSel.addEventListener("change", () => {
    state.state = stateSel.value;
    commit();
  });
  sortSel.addEventListener("change", () => {
    state.sort = sortSel.value;
    commit();
  });
  const searchCommit = (): void => {
    if (search.value === state.q) return;
    state.q = search.value;
    commit();
  };
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchCommit();
  });
  search.addEventListener("blur", searchCommit);

  newBtn.addEventListener("click", () => void openNewStyle(newBtn));
  catBtn.addEventListener("click", () => void openCatalogue(catBtn));

  // Labels and seasons feed the filters.
  void api<{ labels: LabelRow[] }>("/api/labels").then((out) => {
    labelSel.append(el("option", { value: "" }, "All labels"));
    for (const label of out.labels) {
      labelSel.append(el("option", { value: label.id }, label.name));
    }
    if (state.label) labelSel.value = state.label;
  });

  void load(false);

  const timer = window.setInterval(() => {
    void load(false);
  }, 5000);

  return () => window.clearInterval(timer);

  async function openNewStyle(opener: HTMLElement): Promise<void> {
    const { overlayOpen, overlayClose } = await import("./overlay.js");
    const body = overlayOpen({ label: "New style", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const problems = el("div", { class: "problems", role: "region", "aria-label": UI.problems, hidden: "true" });
    const labels = await api<{ labels: LabelRow[] }>("/api/labels");
    const fields: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = {};
    const addField = (label: string, control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
      const wrap = el("label", { class: "field" });
      wrap.append(el("span", {}, label), control);
      body.append(wrap);
      fields[label] = control;
    };
    const labelSel2 = el("select", { "aria-label": "Label" });
    for (const label of labels.labels) labelSel2.append(el("option", { value: label.id }, label.name));
    labelSel2.value = labels.labels[0]?.id ?? "";
    const name = el("input", { type: "text", "aria-label": "Name" });
    const code = el("input", { type: "text", "aria-label": "Style code" });
    const season = el("input", { type: "text", "aria-label": "Season" });
    const gtin = el("input", { type: "text", "aria-label": "GTIN" });
    const garment = el("select", { "aria-label": "Garment" });
    for (const [id, gname] of [["tshirt", "T-shirt"], ["shirt", "Shirt"], ["jeans", "Jeans"], ["coat", "Coat"]] as [string, string][]) {
      garment.append(el("option", { value: id }, gname));
    }
    const washes = el("input", { type: "text", "aria-label": "Washes" });
    washes.value = "30";
    const repair = el("select", { "aria-label": "Repair service offered" });
    repair.append(el("option", { value: "" }, "Not stated"), el("option", { value: "true" }, "Yes"), el("option", { value: "false" }, "No"));
    const rangeSize = el("input", { type: "text", "aria-label": "Range size" });
    const notes = el("textarea", { "aria-label": "Notes", rows: "3" });
    body.append(problems);
    addField("Label", labelSel2);
    addField("Name", name);
    addField("Style code", code);
    addField("Season", season);
    addField("GTIN", gtin);
    addField("Garment", garment);
    addField("Washes", washes);
    addField("Repair service offered", repair);
    addField("Range size", rangeSize);
    addField("Notes", notes);
    const save = el("button", { class: "btn btn-primary" }, "Save style");
    const close = el("button", { class: "btn" }, "Close");
    close.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(el("div", { class: "dialog-foot" }, save, close));
    save.addEventListener("click", async () => {
      await withWorking(save, UI.working, async () => {
        try {
          const out = await api<{ id: string; name: string }>("/api/styles", {
            method: "POST",
            body: JSON.stringify({
              labelId: labelSel2.value,
              name: name.value,
              styleCode: code.value || null,
              season: season.value,
              gtin: gtin.value,
              garment: garment.value,
              washes: Number.parseInt(washes.value, 10) || 30,
              repairService: repair.value === "" ? null : repair.value === "true",
              rangeSize: rangeSize.value === "" ? null : Number.parseInt(rangeSize.value, 10),
              notes: notes.value === "" ? null : notes.value,
            }),
          });
          announce(UI.styleAdded(out.name));
          overlayClose(dialog);
          navigate(`/styles/${out.id}`);
        } catch (err) {
          showProblems(problems, err as { fields?: Record<string, string>; message?: string }, fields);
        }
      });
    });
  }

  async function openCatalogue(opener: HTMLElement): Promise<void> {
    const { overlayOpen, overlayClose } = await import("./overlay.js");
    const body = overlayOpen({ label: "Bring in catalogue", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const labels = await api<{ labels: LabelRow[] }>("/api/labels");
    const labelSel2 = el("select", { "aria-label": "Label" });
    for (const label of labels.labels) labelSel2.append(el("option", { value: label.id }, label.name));
    labelSel2.value = labels.labels[0]?.id ?? "";
    const file = el("input", { type: "file", "aria-label": "Catalogue file", accept: ".csv,text/csv" });
    const previewBtn = el("button", { class: "btn" }, "Preview");
    const saveBtn = el("button", { class: "btn btn-primary" }, "Save catalogue");
    const close = el("button", { class: "btn" }, "Close");
    close.addEventListener("click", () => overlayClose(dialog, opener));
    const previewWrap = el("div");
    const labelWrap = el("label", { class: "field" }, el("span", {}, "Label"));
    labelWrap.append(labelSel2);
    const fileWrap = el("label", { class: "field" }, el("span", {}, "Catalogue file"));
    fileWrap.append(file);
    body.append(labelWrap, fileWrap, el("div", { class: "dialog-foot" }, previewBtn, saveBtn, close), previewWrap);
    let csvText = "";
    file.addEventListener("change", async () => {
      csvText = await file.files?.[0]?.text() ?? "";
    });
    previewBtn.addEventListener("click", async () => {
      await withWorking(previewBtn, UI.working, async () => {
        try {
          const out = await api<{ rows: { row: number; styleCode: string | null; name: string | null; outcome: string; reason: string | null }[] }>(
            `/api/labels/${labelSel2.value}/catalogue/preview`,
            { method: "POST", headers: { "Content-Type": "text/csv" }, body: csvText },
          );
          announce(UI.previewReady(out.rows.filter((r) => r.outcome === "new").length, out.rows.filter((r) => r.outcome === "matched").length, out.rows.filter((r) => r.outcome === "refused").length));
          previewWrap.textContent = "";
          const frame = el("div", { class: "table-frame", tabindex: "0", role: "region", "aria-label": "Catalogue preview" });
          const t = el("table");
          const head = el("thead");
          const trh = el("tr");
          for (const h of ["Row", "Style code", "Name", "Outcome", "Reason"]) trh.append(el("th", {}, h));
          head.append(trh);
          const tb = el("tbody");
          for (const r of out.rows) {
            const tr = el("tr");
            tr.append(
              el("td", {}, String(r.row)),
              el("td", {}, r.styleCode ?? ""),
              el("td", {}, r.name ?? ""),
              el("td", {}, r.outcome),
              el("td", {}, r.reason ?? ""),
            );
            tb.append(tr);
          }
          t.append(head, tb);
          frame.append(t);
          previewWrap.append(frame);
        } catch (err) {
          announce((err as { message?: string }).message ?? `Something went wrong.`);
        }
      });
    });
    saveBtn.addEventListener("click", async () => {
      await withWorking(saveBtn, UI.working, async () => {
        try {
          const out = await api<{ newCount: number; matchedCount: number; refusedCount: number }>(
            `/api/labels/${labelSel2.value}/catalogue/save`,
            { method: "POST", headers: { "Content-Type": "text/csv" }, body: csvText },
          );
          announce(UI.catalogueSaved(out.newCount, out.matchedCount, out.refusedCount));
          overlayClose(dialog, opener);
          void load(false);
        } catch (err) {
          announce((err as { message?: string }).message ?? `Something went wrong.`);
        }
      });
    });
  }

  function showProblems(
    region: HTMLElement,
    failure: { fields?: Record<string, string>; message?: string },
    fields: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ): void {
    region.hidden = false;
    region.textContent = "";
    const entries = Object.entries(failure.fields ?? {});
    if (entries.length > 0) {
      for (const [key, message] of entries) {
        const control = Object.entries(fields).find(([label]) => label.toLowerCase() === key.toLowerCase())?.[1];
        if (control) control.setAttribute("aria-invalid", "true");
        const link = el("a", { href: "#" }, message);
        link.addEventListener("click", (e) => {
          e.preventDefault();
          (control ?? region).focus();
        });
        region.append(el("p", {}, link));
      }
    } else {
      region.append(el("p", {}, failure.message ?? `Give a value here.`));
    }
    announce(entries[0]?.[1] ?? failure.message ?? `Give a value here.`);
    region.focus?.();
  }
}
