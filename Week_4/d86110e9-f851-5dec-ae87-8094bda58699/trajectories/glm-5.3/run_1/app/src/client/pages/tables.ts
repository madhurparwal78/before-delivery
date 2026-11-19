// Tables list and table detail with the row grid and add-row form.

import { h } from "../runtime";
import type { Me } from "../runtime";
import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { api
, navigate, onEvent } from "../runtime";
import type { TableShape } from "../runtime";
import type { ApiError } from "../runtime";
import { Btn, Dialog, Field, Select, StatusLog } from "../ui";

export function TablesPage(p: { me: Me | null; wsId: string }): VNode {
  const [tables, setTables] = useState<TableShape[]>([]);
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState("");
  const [cols, setCols] = useState<{ name: string; type: string }[]>([{ name: "", type: "text" }]);
  const [notice, setNotice] = useState<string[]>([]);
  const viewer = p.me?.workspaces.find((w) => w.id === p.wsId)?.role === "viewer";

  const load = () => { void api<{ tables: TableShape[] }>(`/api/workspaces/${p.wsId}/tables`).then((r) => setTables(r.tables)).catch(() => setTables([])); };
  useEffect(() => {
    load();
    return onEvent((ev) => { if (ev.type === "table") load(); });
  }, [p.wsId]);

  const create = async () => {
    try {
      const t = await api<TableShape>(`/api/workspaces/${p.wsId}/tables`, {
        method: "POST", body: JSON.stringify({ name, columns: cols.filter((c) => c.name.trim() !== "") }),
      });
      setDialog(false);
      setNotice((prev) => [...prev.slice(-19), "Table created"]);
      void load();
      void t;
    } catch (e) {
      setNotice((prev) => [...prev.slice(-19), (e as ApiError).message]);
    }
  };

  return h("div", { class: "page" },
    h("h1", { class: "page-heading" }, "Tables"),
    h("div", { class: "actions-row" },
      h(Btn, { kind: "primary", onClick: () => setDialog(true), disabled: viewer }, "New table"),
      viewer ? h("span", { id: "viewer-desc", class: "visually-hidden" }, "Viewers cannot change this workspace") : null),
    h("div", { class: "notice-region" }, h(StatusLog, { name: "Notices", lines: notice })),
    tables.length === 0
      ? h("div", { class: "empty-state" }, h("div", { class: "lattice-mini" }), h("p", {}, "No tables yet."))
      : h("ul", { class: "table-list", "aria-label": "Tables" },
          tables.map((t) => h("li", { key: t.id, class: "table-row-item" },
            h("a", { class: "table-name", href: `/w/${p.wsId}/tables/${t.id}`, onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${p.wsId}/tables/${t.id}`); } }, t.name),
            h("span", { class: "chip" }, `${t.row_count} rows`)))),
    dialog ? h(Dialog, { label: "New table", onClose: () => setDialog(false) }, [
      h("h2", { class: "dialog-heading" }, "New table"),
      h(Field, { label: "Table name", value: name, onInput: setName }),
      cols.map((c, i) => h("div", { key: i, class: "col-row" },
        h(Field, { label: `Column name ${i + 1}`, value: c.name, onInput: (v: string) => setCols((prev) => prev.map((x, xi) => xi === i ? { ...x, name: v } : x)) }),
        h(Select, { label: `Column type ${i + 1}`, value: c.type, options: ["text", "number"], onChange: (v: string) => setCols((prev) => prev.map((x, xi) => xi === i ? { ...x, type: v } : x)) }))),
      h(Btn, { onClick: () => setCols((prev) => [...prev, { name: "", type: "text" }]) }, "Add column"),
      h("div", { class: "dialog-actions" },
        h(Btn, { kind: "primary", onClick: () => void create() }, "Create table"),
        h(Btn, { onClick: () => setDialog(false) }, "Close")),
    ]) : null);
}

interface TableDetail { id: string; name: string; columns: { name: string; type: string }[]; rows: Record<string, unknown>[] }

export function TableDetailPage(p: { me: Me | null; wsId: string; tid: string }): VNode {
  const [table, setTable] = useState<TableDetail | null>(null);
  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string[]>([]);
  const viewer = p.me?.workspaces.find((w) => w.id === p.wsId)?.role === "viewer";

  const load = () => { void api<TableDetail>(`/api/workspaces/${p.wsId}/tables/${p.tid}`).then(setTable).catch(() => setTable(null)); };
  useEffect(() => {
    load();
    return onEvent((ev) => { if (ev.type === "table") load(); });
  }, [p.wsId, p.tid]);

  const addRow = async () => {
    try {
      await api(`/api/workspaces/${p.wsId}/tables/${p.tid}/rows`, {
        method: "POST", body: JSON.stringify({ values: newRow }),
      });
      setNotice((prev) => [...prev.slice(-19), "Row added"]);
      setNewRow({});
      load();
    } catch (e) {
      setNotice((prev) => [...prev.slice(-19), (e as ApiError).message]);
    }
  };

  if (!table) return h("div", { class: "page" }, h("h1", { class: "page-heading" }, "Table"));
  return h("div", { class: "page" },
    h("h1", { class: "page-heading" }, table.name),
    h("div", { class: "notice-region" }, h(StatusLog, { name: "Notices", lines: notice })),
    h("table", { class: "data-table", "aria-label": table.name },
      h("thead", {}, h("tr", {},
        h("th", { class: "col-head", scope: "col" }, "Row id"),
        table.columns.map((c) => h("th", { key: c.name, class: "col-head", scope: "col" }, c.name)))),
      h("tbody", {}, table.rows.map((r) => h("tr", { key: String(r._row_id), "data-row-id": String(r._row_id) },
        h("td", { class: "cell mono" }, String(r._row_id)),
        table.columns.map((c) => h("td", { key: c.name, class: "cell" }, String(r[c.name] ?? ""))))))),
    h("div", { class: "add-row-form" },
      table.columns.map((c) => h(Field, {
        key: c.name,
        label: `New row: ${c.name}`,
        value: newRow[c.name] ?? "",
        onInput: (v: string) => setNewRow((prev) => ({ ...prev, [c.name]: v })),
        disabled: viewer,
      })),
      h(Btn, { kind: "primary", onClick: () => void addRow(), disabled: viewer }, "Add row")));
}
