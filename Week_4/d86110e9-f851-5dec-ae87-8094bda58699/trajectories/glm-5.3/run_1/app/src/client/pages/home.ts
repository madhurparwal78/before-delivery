// Workspace home: automations list with actions.

import { h } from "../runtime";
import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { api, fmtTime, navigate } from "../runtime";
import type { AutomationShape, Me } from "../runtime";
import { Btn, Dialog, Field, Select, StatusLog } from "../ui";
import type { ApiError } from "../runtime";

interface AutoRow { id: string; name: string; trigger_kind: string; live_version: number | null; next_run_at: string | null; drain_count: number }

export function WorkspaceHome(p: { me: Me | null; wsId: string }): VNode {
  const [rows, setRows] = useState<AutoRow[]>([]);
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("form");
  const [notice, setNotice] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const viewer = p.me?.workspaces.find((w) => w.id === p.wsId)?.role === "viewer";

  const load = () => {
    void api<{ automations: AutoRow[] }>(`/api/workspaces/${p.wsId}/automations`).then((r) => setRows(r.automations)).catch(() => setRows([]));
  };
  useEffect(load, [p.wsId]);

  const create = async () => {
    setBusy(true);
    try {
      const a = await api<AutomationShape>(`/api/workspaces/${p.wsId}/automations`, {
        method: "POST", body: JSON.stringify({ name, trigger_kind: trigger }),
      });
      setDialog(false);
      navigate(`/w/${p.wsId}/automations/${a.id}`);
    } catch (e) {
      setNotice((prev) => [...prev.slice(-19), (e as ApiError).message]);
    } finally { setBusy(false); }
  };

  return h("div", { class: "page" },
    h("h1", { class: "page-heading" }, "Automations"),
    h("div", { class: "actions-row" },
      h(Btn, { kind: "primary", onClick: () => setDialog(true), disabled: viewer, describedBy: viewer ? "viewer-desc" : undefined }, "New automation"),
      viewer ? h("span", { id: "viewer-desc", class: "visually-hidden" }, "Viewers cannot change this workspace") : null,
      h(Btn, { onClick: () => importAndUpload(), disabled: viewer }, "Import automation"),
      h("input", {
        type: "file", "aria-label": "Automation file", class: "file-input", id: "import-file",
        accept: "application/json", style: "display:none",
        onChange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void doImport(f); },
      })),
    h("div", { class: "notice-region" },
      h(StatusLog, { name: "Notices", lines: notice })),
    rows.length === 0
      ? h("div", { class: "empty-state" }, h("div", { class: "lattice-mini" }), h("p", {}, "No automations yet."))
      : h("ul", { class: "auto-list", "aria-label": "Automations" },
          rows.map((r) => h("li", { key: r.id, class: "auto-row" },
            h("a", { class: "auto-name", href: `/w/${p.wsId}/automations/${r.id}`, onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${p.wsId}/automations/${r.id}`); } }, r.name),
            h("span", { class: "chip chip-kind" }, r.trigger_kind),
            r.live_version === null
              ? h("span", { class: "chip chip-draft" }, "Draft only")
              : h("span", { class: "chip chip-version" }, "Live v" + r.live_version),
            r.next_run_at ? h("span", { class: "auto-next" }, "Next run " + fmtTime(r.next_run_at)) : null))),
    dialog
      ? h(Dialog, { label: "New automation", onClose: () => setDialog(false) }, [
          h("h2", { class: "dialog-heading" }, "New automation"),
          h(Field, { label: "Automation name", value: name, onInput: setName }),
          h(Select, { label: "Trigger", value: trigger, options: ["Form", "Schedule", "Webhook", "Row added", "Manual"].map((l, i) => ({ value: ["form", "schedule", "webhook", "row_added", "manual"][i], label: l })), onChange: setTrigger }),
          h("div", { class: "dialog-actions" },
            h(Btn, { kind: "primary", onClick: () => void create(), disabled: busy }, busy ? "Working..." : "Create automation"),
            h(Btn, { onClick: () => setDialog(false) }, "Close")),
        ])
      : null);

  function importAndUpload(): void {
    document.getElementById("import-file")?.click();
  }

  async function doImport(f: File): Promise<void> {
    setBusy(true);
    setNotice((prev) => [...prev.slice(-19), "Saving import..."]);
    try {
      const buf = await f.arrayBuffer();
      const r = await fetch(`/api/workspaces/${p.wsId}/imports`, {
        method: "POST", body: buf, headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      });
      const body = r.status === 204 ? null : await r.json().catch(() => null);
      if (!r.ok) {
        const msg = (body as { error?: string })?.error ?? "Import failed";
        setNotice((prev) => [...prev.slice(-19), msg]);
        return;
      }
      const { automation_id } = body as { automation_id: string };
      navigate(`/w/${p.wsId}/automations/${automation_id}`);
    } finally { setBusy(false); }
  }
}
