// Saved queries: the list, the New query dialog and the results table.

import { api, apiFail, type QueryJson, type ObjectJson, type TypeJson } from "./api.js";
import { h, clearChildren, openDialog, alertMessage, clearAlert } from "./dom.js";
import { state, screens, mainEl, navigate, updateTopbarTitle } from "./app.js";
import { SEARCH_DEBOUNCE, MOTION, QUIRE_CURVE } from "./constants.js";

interface QueryRow {
  id: string;
  title: string;
  type_name: string;
  backlinks: number;
  updated_at: string;
}

interface QueryResults {
  results: QueryRow[];
  groups: Array<{ key: unknown; label: string; count: number; results: QueryRow[] }> | null;
}

export function openQueriesScreen(): void {
  screens.current = { dispose: () => undefined };
  void load();

  async function load(): Promise<void> {
    let queries: QueryJson[] = [];
    try {
      const res = await api<{ queries: QueryJson[] }>("GET", "/api/queries");
      queries = res.queries;
    } catch {
      // the frame shows not found copy elsewhere
    }
    const main = mainEl();
    clearChildren(main);
    clearAlert();
    updateTopbarTitle("Queries");
    main.append(h("h1", { text: "Queries" }));
    main.append(h("button", { class: "new-query", onclick: () => openNewQueryDialog() }, "New query"));
    const list = h("ul", { class: "saved-queries", "aria-label": "Saved queries" });
    for (const q of queries) {
      list.append(h("li", {},
        h("a", { href: `/queries/${q.id}`, onclick: (e: MouseEvent) => { e.preventDefault(); void navigate(`/queries/${q.id}`); } }, q.name)
      ));
    }
    main.append(list);
  }
}

export function openQueryScreen(queryId: string): void {
  const onEvent = (ev: Event): void => {
    const detail = (ev as CustomEvent).detail as { event: string; data: Record<string, unknown> };
    if (detail.event === "backlinks.changed" || detail.event === "object.saved" || detail.event === "object.removed") {
      void load();
    }
  };
  document.addEventListener("quire-event", onEvent);
  screens.current = { dispose: () => document.removeEventListener("quire-event", onEvent) };
  void load();

  async function load(): Promise<void> {
    let query: QueryJson;
    let results: QueryResults;
    try {
      query = await api<QueryJson>("GET", `/api/queries/${queryId}`);
      results = await api<QueryResults>("GET", `/api/queries/${queryId}/results`);
    } catch {
      const main = mainEl();
      clearChildren(main);
      main.append(h("h1", { text: "We can't find that note." }));
      return;
    }
    const main = mainEl();
    clearChildren(main);
    clearAlert();
    updateTopbarTitle(query.name);
    main.append(h("h1", { text: query.name }));
    main.append(h("button", { class: "ghost danger", onclick: async () => {
      await api("DELETE", `/api/queries/${queryId}`);
      void navigate("/queries");
    } }, "Delete query"));
    const type = state.app?.types.find((t) => t.id === query.type_id);
    main.append(h("p", { class: "query-text" }, `“${query.text}”`));
    main.append(h("p", { class: "query-meta" }, type?.name ?? ""));
    // results with live counts, animated reorder
    const table = h("table", { class: "query-results", "aria-label": "Query results" },
      h("thead", {}, h("tr", {}, h("th", {}, "Title"), h("th", {}, "Type"), h("th", {}, "Backlinks"), h("th", {}, "Last updated"))),
      h("tbody", {})
    );
    const tbody = table.querySelector("tbody") as HTMLElement;
    const buildRow = (row: QueryRow): HTMLElement => {
      const tr = h("tr", {},
        h("td", {}, h("a", { href: `/o/${row.id}`, onclick: (e: MouseEvent) => { e.preventDefault(); void navigate(`/o/${row.id}`); } }, row.title)),
        h("td", {}, row.type_name),
        h("td", { "data-backlink-count": row.backlinks }, String(row.backlinks)),
        h("td", {}, row.updated_at)
      );
      return tr;
    };
    const prevRows = new Map<string, HTMLElement>();
    const renderRows = (rows: QueryRow[], order: number): void => {
      const newRows = new Map<string, HTMLElement>();
      const existing = Array.from(tbody.children) as HTMLElement[];
      rows.forEach((row, i) => {
        const old = existing.find((el) => el.dataset.rowId === row.id);
        if (old !== undefined) {
          newRows.set(row.id, old);
          const count = old.querySelector("[data-backlink-count]");
          if (count !== null) {
            count.setAttribute("data-backlink-count", String(row.backlinks));
            count.textContent = String(row.backlinks);
          }
          // slide to its new place
          if (order > 0 && Array.prototype.indexOf.call(tbody.children, old) !== i) {
            const from = old.getBoundingClientRect().top;
            requestAnimationFrame(() => {
              const to = old.getBoundingClientRect().top;
              if (Math.abs(to - from) > 1) {
                old.animate(
                  [{ transform: `translateY(${from - to}px)` }, { transform: "translateY(0)" }],
                  { duration: MOTION.reorderSlide, easing: QUIRE_CURVE }
                );
              }
            });
          }
        } else {
          const tr = buildRow(row);
          tr.dataset.rowId = row.id;
          newRows.set(row.id, tr);
          if (order > 0) tr.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.newRowsFade, easing: "ease" });
        }
      });
      tbody.replaceChildren(...rows.map((r) => newRows.get(r.id) as HTMLElement));
      void prevRows;
    };
    let order = 0;
    if (results.groups !== null) {
      results.groups.forEach((group) => {
        const head = h("tr", { class: "group-row" }, h("td", { colspan: "4" }, `${group.label} (${group.count})`));
        tbody.append(head);
        renderRows(group.results, order);
        order += 1;
      });
    } else {
      renderRows(results.results, 0);
    }
    main.append(table);
  }
}

export function openNewQueryDialog(): void {
  const types = state.app?.types ?? [];
  const nameInput = h("input", { type: "text", "aria-label": "Query name" });
  const typeSel = h("select", { "aria-label": "Type" });
  for (const t of types) {
    typeSel.append(h("option", { value: t.id }, t.name));
  }
  const textInput = h("input", { type: "text", "aria-label": "Query", class: "query-input" });
  const checkResult = h("div", { class: "field-error", "aria-live": "polite" });
  textInput.setAttribute("aria-describedby", "query-check");
  checkResult.id = "query-check";
  const groupSel = h("select", { "aria-label": "Group by" });
  const sortHost = h("div", { class: "sort-rows" });
  const save = h("button", {}, "Save query");

  const fillGroupAndSort = (): void => {
    const typeId = typeSel.value;
    const type = types.find((t) => t.id === typeId);
    groupSel.replaceChildren(h("option", { value: "" }, "No grouping"));
    sortHost.replaceChildren();
    if (type === undefined) return;
    for (const f of type.fields) {
      if (f.kind === "select" || f.kind === "relation" || f.kind === "date" || f.kind === "text") {
        groupSel.append(h("option", { value: f.name }, f.name));
      }
    }
    for (let i = 1; i <= 3; i += 1) {
      const keySel = h("select", { "aria-label": `Sort key ${i}` });
      const dirSel = h("select", { "aria-label": `Direction ${i}` });
      dirSel.append(h("option", { value: "asc" }, "Ascending"), h("option", { value: "desc" }, "Descending"));
      const keyOptions = (): void => {
        keySel.replaceChildren(
          h("option", { value: "@title" }, "Title"),
          h("option", { value: "@backlinks" }, "Backlinks"),
          h("option", { value: "@updated" }, "Last updated")
        );
        for (const f of type.fields) keySel.append(h("option", { value: f.name }, f.name));
        if (i > 1) {
          keySel.prepend(h("option", { value: "" }, "None"));
          keySel.value = "";
        }
      };
      keyOptions();
      sortHost.append(h("div", { class: "sort-row" }, keySel, dirSel));
    }
  };
  typeSel.addEventListener("change", fillGroupAndSort);
  fillGroupAndSort();

  let checkToken = 0;
  textInput.addEventListener("input", () => {
    const token = ++checkToken;
    window.setTimeout(() => {
      void api("POST", "/api/queries/check", { type_id: typeSel.value, text: textInput.value })
        .then(() => {
          if (token === checkToken) checkResult.textContent = "";
        })
        .catch((e) => {
          if (token !== checkToken) return;
          checkResult.textContent = apiFail(e, "text");
        });
    }, SEARCH_DEBOUNCE);
  });

  const dialog = h("div", { role: "dialog", "aria-label": "New query", class: "dialog" },
    h("h2", { text: "New query" }),
    h("label", {}, "Query name ", nameInput),
    h("label", {}, "Type ", typeSel),
    h("label", {}, "Query ", textInput),
    checkResult,
    h("label", {}, "Group by ", groupSel),
    sortHost,
    save
  );
  const overlay = h("div", { class: "dialog-overlay" }, dialog);
  document.body.append(overlay);
  const handle = openDialog(overlay, document.activeElement as HTMLElement | null);
  dialog.addEventListener("dialog-close", () => {
    overlay.remove();
    handle.close();
  });
  save.addEventListener("click", async () => {
    const sort: Array<{ key: string; dir: string }> = [];
    Array.from(sortHost.querySelectorAll(".sort-row")).forEach((row) => {
      const key = (row.querySelector("select") as HTMLSelectElement).value;
      const dir = (row.querySelectorAll("select")[1] as HTMLSelectElement).value;
      if (key !== "") sort.push({ key, dir });
    });
    const groupBy = groupSel.value === "" ? null : groupSel.value;
    try {
      const res = await api<QueryJson>("POST", "/api/queries", { name: nameInput.value, type_id: typeSel.value, text: textInput.value, group_by: groupBy, sort });
      dialog.dispatchEvent(new CustomEvent("dialog-close"));
      void navigate(`/queries/${res.id}`);
    } catch (e) {
      const failures = apiFail(e, "name");
      // show the first invalid field under that field
      alertMessage(failures);
    }
  });
  nameInput.focus();
}
