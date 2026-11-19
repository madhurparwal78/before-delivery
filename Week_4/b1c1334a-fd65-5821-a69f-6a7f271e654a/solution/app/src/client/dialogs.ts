// The workspace's create, rename and formula dialogs.
import type { Column, Recalc, TableData } from "./api.js";
import { docPath, request, tablePath } from "./api.js";
import { COPY } from "./copy.js";
import { Dialog, field, radioGroup } from "./dialog.js";
import { announce, button, h, layoutOf, setBusy } from "./dom.js";
import { Preview } from "./preview.js";
import type { Workspace } from "./workspace.js";

// Enter in the last single-line field submits; at 375 a formula textbox never inserts a line.
function submitOnEnter(control: HTMLElement, submit: () => void, multiline = false): void {
  control.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!multiline || layoutOf() !== "phone") submit();
  });
}

function formulaBox(): HTMLTextAreaElement {
  return h("textarea", { rows: "3", class: "formula-text", spellcheck: "false", autocomplete: "off" }) as HTMLTextAreaElement;
}

export function newTableDialog(ws: Workspace, opener: HTMLElement): void {
  const input = h("input", { type: "text", autocomplete: "off" }) as HTMLInputElement;
  const name = field("Table name", input);
  const create = button("Create table", { class: "btn primary" });
  const dialog = new Dialog({ title: "New table", returnTo: () => opener });
  const submit = () => {
    setBusy(create, true);
    ws.commit("POST", `${docPath(ws.docId)}/tables`, { name: input.value }, {
      label: "create",
      success: (data: { table: TableData; recalc: Recalc }) => {
        dialog.close(false);
        ws.tables.push({ id: data.table.id, name: data.table.name, kind: "table", revision: 1, row_count: 0, column_count: 0, source_table_id: null });
        ws.showTable(data.table.id, true, { focus: "landing", announce: COPY.tableCreated(data.table.name) });
      },
      refused: (status, error) => {
        setBusy(create, false);
        if (status === 422) {
          name.setError(error?.fields?.name ?? "");
          input.focus();
        }
        return null;
      },
      failed: () => setBusy(create, false),
    });
  };
  create.addEventListener("click", submit);
  submitOnEnter(input, submit);
  dialog.body.append(name.wrap, h("div", { class: "dialog-buttons" }, create, button("Cancel", { onclick: () => dialog.close() })));
  dialog.show();
}

export function newSummaryDialog(ws: Workspace, opener: HTMLElement): void {
  const sources = ws.tables.filter((t) => t.kind === "table");
  const source = h("select", {}, ...sources.map((t) => h("option", { value: t.id }, t.name))) as HTMLSelectElement;
  const groups = [1, 2, 3].map(() => h("select", {}) as HTMLSelectElement);
  const sums = h("fieldset", { class: "checks", role: "group", "aria-label": "Sum columns" }, h("legend", {}, "Sum columns"));
  const groupBox = h("fieldset", { class: "groups", role: "group", "aria-label": "Group by" }, h("legend", {}, "Group by"));
  const message = h("p", { class: "field-message", role: "status" });
  let columns: Column[] = [];
  const fill = async () => {
    const chosen = source.value;
    const answer = await request<{ table: TableData }>("GET", tablePath(ws.docId, chosen));
    if (!answer.ok || chosen !== source.value) return;
    columns = [...answer.data.table.columns].sort((a, b) => a.position - b.position);
    groups.forEach((select, i) => {
      select.replaceChildren(...(i > 0 ? [h("option", { value: "" }, "None")] : []), ...columns.map((c) => h("option", { value: c.id }, c.name)));
      select.value = i === 0 ? (columns[0]?.id ?? "") : "";
    });
    sums.replaceChildren(h("legend", {}, "Sum columns"), ...columns.filter((c) => c.type === "decimal" || c.type === "formula").map((c) =>
      h("label", { class: "check" }, h("input", { type: "checkbox", value: c.id }), h("span", {}, c.name))));
  };
  groups.forEach((select, i) => {
    const id = `group-${i + 1}-${Math.random().toString(36).slice(2, 8)}`;
    select.id = id;
    groupBox.append(h("div", { class: "field" }, h("label", { for: id }, `Group by column ${i + 1}`), select));
  });
  source.addEventListener("change", () => void fill());
  const create = button("Create summary", { class: "btn primary" });
  const dialog = new Dialog({ title: "New summary", returnTo: () => opener });
  create.addEventListener("click", () => {
    setBusy(create, true);
    const groupBy = groups.map((g) => g.value).filter((v) => v !== "");
    const sumColumns = [...sums.querySelectorAll<HTMLInputElement>("input:checked")].map((c) => c.value);
    ws.commit("POST", `${docPath(ws.docId)}/summaries`, { source_table_id: source.value, group_by: groupBy, sum_columns: sumColumns }, {
      label: "create",
      success: (data: { table: TableData; recalc: Recalc }) => {
        dialog.close(false);
        ws.showTable(data.table.id, true, { focus: "landing", announce: COPY.summaryCreated(data.table.name) });
      },
      refused: (status, error) => {
        setBusy(create, false);
        if (status === 422) message.textContent = Object.values(error?.fields ?? {})[0] ?? "";
        return null;
      },
      failed: () => setBusy(create, false),
    });
  });
  dialog.body.append(field("Source table", source).wrap, groupBox, sums, message, h("div", { class: "dialog-buttons" }, create, button("Cancel", { onclick: () => dialog.close() })));
  dialog.show();
  void fill();
}

export function renameTableDialog(ws: Workspace, opener: HTMLElement): void {
  const table = ws.table!;
  let revision = table.revision;
  const input = h("input", { type: "text", autocomplete: "off" }) as HTMLInputElement;
  input.value = table.name;
  const name = field("Table name", input);
  const notice = h("p", { class: "dialog-notice", role: "status" });
  const save = button("Save name", { class: "btn primary" });
  const dialog = new Dialog({ title: "Rename table", returnTo: () => ws.control("rename-table") ?? opener });
  const submit = () => {
    setBusy(save, true);
    ws.commit("PATCH", tablePath(ws.docId, table.id), { name: input.value, revision }, {
      label: "table",
      reload: true,
      success: () => {
        dialog.close(false);
        queueMicrotask(() => ws.control("rename-table")?.focus());
      },
      refused: (status, error) => {
        setBusy(save, false);
        if (status === 409 && error?.current?.table) {
          input.value = error.current.table.name;
          revision = error.current.table.revision;
          notice.textContent = COPY.tableConflict;
          return COPY.tableConflict;
        }
        if (status === 422) {
          name.setError(Object.values(error?.fields ?? {})[0] ?? "");
          input.focus();
        }
        return null;
      },
      failed: () => setBusy(save, false),
    });
  };
  save.addEventListener("click", submit);
  submitOnEnter(input, submit);
  dialog.body.append(name.wrap, notice, h("div", { class: "dialog-buttons" }, save, button("Cancel", { onclick: () => dialog.close() })));
  dialog.show();
}

export function addColumnDialog(ws: Workspace, opener: HTMLElement): void {
  const table = ws.table!;
  const nameInput = h("input", { type: "text", autocomplete: "off" }) as HTMLInputElement;
  const name = field("Column name", nameInput);
  const types = radioGroup("column-type", "Type", [["text", "Text"], ["decimal", "Decimal"], ["date", "Date"], ["bool", "Bool"], ["reference", "Reference"], ["formula", "Formula"]], "text");
  const target = h("select", {}, ...ws.tables.filter((t) => t.kind === "table").map((t) => h("option", { value: t.id }, t.name))) as HTMLSelectElement;
  const targetField = field("Target table", target);
  const formula = formulaBox();
  const formulaField = field("Formula", formula);
  const status = h("div", { role: "status", "aria-label": "Formula preview", class: "formula-preview" });
  const activeRow = (ws.view as { activePosition?: () => { row?: { id: string } } } | null)?.activePosition?.().row?.id;
  const previewRow = activeRow ?? ws.rows[0]?.id ?? null;
  const preview = new Preview(ws, status, () => ({ tableId: table.id, rowId: previewRow }));
  formula.addEventListener("input", () => preview.update(formula.value));
  const extra = h("div", { class: "type-extra" });
  const showExtra = () => {
    const type = types.value();
    extra.replaceChildren(...(type === "reference" ? [targetField.wrap] : type === "formula" ? [formulaField.wrap, status] : []));
  };
  types.radios.forEach((r) => r.addEventListener("change", showExtra));
  const create = button("Create column", { class: "btn primary" });
  const dialog = new Dialog({ title: "Add column", returnTo: () => ws.control("add-column") ?? opener, onClose: () => preview.stop() });
  const submit = () => {
    const type = types.value();
    const body: Record<string, string> = { name: nameInput.value, type };
    if (type === "reference") body.target_table_id = target.value;
    if (type === "formula") body.formula = formula.value;
    setBusy(create, true);
    ws.commit("POST", `${tablePath(ws.docId, table.id)}/columns`, body, {
      label: "column",
      reload: true,
      success: (data: { column: Column }) => {
        dialog.close(false);
        announce(ws.live.workspace, COPY.columnAdded(data.column.name));
        queueMicrotask(() => {
          if (ws.layout === "phone") {
            const edit = ws.view?.el.querySelector<HTMLElement>(`[data-edit$="|${CSS.escape(data.column.id)}"]`);
            (edit ?? ws.control("add-row"))?.focus();
          } else (ws.view as { focusHeader?: (id: string) => void } | null)?.focusHeader?.(data.column.id);
        });
      },
      refused: (status, error) => {
        setBusy(create, false);
        if (status === 422) {
          const fields = error?.fields ?? {};
          if (fields.name) name.setError(fields.name);
          if (fields.formula) formulaField.setError(fields.formula);
          if (fields.target_table_id) targetField.setError(fields.target_table_id);
          (fields.name ? nameInput : fields.formula ? formula : target).focus();
        }
        return null;
      },
      failed: () => setBusy(create, false),
    });
  };
  create.addEventListener("click", submit);
  submitOnEnter(nameInput, submit);
  submitOnEnter(formula, submit, true);
  dialog.body.append(name.wrap, types.group, extra, h("div", { class: "dialog-buttons" }, create, button("Cancel", { onclick: () => dialog.close() })));
  dialog.show();
  showExtra();
}

export function renameColumnDialog(ws: Workspace, column: Column, header: HTMLElement): void {
  let revision = column.revision;
  const input = h("input", { type: "text", autocomplete: "off" }) as HTMLInputElement;
  input.value = column.name;
  const name = field("Column name", input);
  const notice = h("p", { class: "dialog-notice", role: "status" });
  const save = button("Save name", { class: "btn primary" });
  const headerFor = () => ws.view?.el.querySelector<HTMLElement>(`[aria-label="${CSS.escape(`${column.name} options`)}"]`) ?? header;
  const dialog = new Dialog({ title: "Rename column", returnTo: headerFor });
  const submit = () => {
    setBusy(save, true);
    ws.commit("PATCH", `${tablePath(ws.docId, ws.table!.id)}/columns/${column.id}`, { revision, name: input.value }, {
      label: "column",
      reload: true,
      success: () => {
        dialog.close(false);
        queueMicrotask(() => (ws.view as { focusHeader?: (id: string) => void } | null)?.focusHeader?.(column.id));
      },
      refused: (status, error) => {
        setBusy(save, false);
        if (status === 409 && error?.current?.column) {
          input.value = error.current.column.name;
          revision = error.current.column.revision;
          notice.textContent = COPY.columnConflict;
          return COPY.columnConflict;
        }
        if (status === 422) {
          name.setError(Object.values(error?.fields ?? {})[0] ?? "");
          input.focus();
        }
        return null;
      },
      failed: () => setBusy(save, false),
    });
  };
  save.addEventListener("click", submit);
  submitOnEnter(input, submit);
  dialog.body.append(name.wrap, notice, h("div", { class: "dialog-buttons" }, save, button("Cancel", { onclick: () => dialog.close() })));
  dialog.show();
}

export function editFormulaDialog(ws: Workspace, column: Column, rowId: string | null, opener: HTMLElement, returnTo: () => HTMLElement | null): void {
  let revision = column.revision;
  const box = formulaBox();
  box.value = column.formula ?? "";
  const formulaField = field("Formula", box);
  const status = h("div", { role: "status", "aria-label": "Formula preview", class: "formula-preview" });
  const previewRow = rowId ?? ws.rows[0]?.id ?? null;
  const preview = new Preview(ws, status, () => ({ tableId: ws.table!.id, rowId: previewRow }));
  box.addEventListener("input", () => preview.update(box.value));
  const notice = h("p", { class: "dialog-notice", role: "status" });
  const save = button("Save formula", { class: "btn primary" });
  const dialog = new Dialog({ title: "Edit formula", returnTo: () => returnTo() ?? opener, onClose: () => preview.stop() });
  const submit = () => {
    if (!ws.canEditTable) {
      ws.readOnlyAttempt();
      return;
    }
    setBusy(save, true);
    ws.commit("PATCH", `${tablePath(ws.docId, ws.table!.id)}/columns/${column.id}`, { revision, formula: box.value }, {
      label: "column",
      reload: true,
      success: () => {
        dialog.close(false);
        queueMicrotask(() => {
          if (ws.layout === "phone") returnTo()?.focus();
          else (ws.view as { focusHeader?: (id: string) => void } | null)?.focusHeader?.(column.id);
        });
      },
      refused: (status, error) => {
        setBusy(save, false);
        if (status === 409 && error?.current?.column) {
          box.value = error.current.column.formula ?? "";
          revision = error.current.column.revision;
          notice.textContent = COPY.columnConflict;
          return COPY.columnConflict;
        }
        if (status === 422) {
          formulaField.setError(Object.values(error?.fields ?? {})[0] ?? "");
          box.focus();
        }
        return null;
      },
      failed: () => setBusy(save, false),
    });
  };
  save.addEventListener("click", submit);
  submitOnEnter(box, submit, true);
  dialog.body.append(formulaField.wrap, status, notice, h("div", { class: "dialog-buttons" }, save, button("Cancel", { onclick: () => dialog.close() })));
  dialog.show();
}
