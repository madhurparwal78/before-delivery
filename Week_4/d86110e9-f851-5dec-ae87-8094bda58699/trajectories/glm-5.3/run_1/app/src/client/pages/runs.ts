// The runs list: filters by keyboard, shown count, live updates.

import { h } from "../runtime";
import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { api, fmtTime, navigate, onEvent } from "../runtime";
import type { RunListItem, Me } from "../runtime";
import type { ApiError } from "../runtime";
import { CheckBox, Select, StatusChip, StatusLog, TestChip } from "../ui";

export function RunsPage(p: { me: Me | null; wsId: string }): VNode {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [status, setStatus] = useState("All");
  const [automation, setAutomation] = useState("");
  const [showTests, setShowTests] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const params = new URLSearchParams(location.search);
  const initAuto = params.get("automation") ?? "";
  const [autos, setAutos] = useState<{ id: string; name: string }[]>([]);

  const load = () => {
    const qs = new URLSearchParams();
    if (status !== "All") qs.set("status", status);
    if (automation) qs.set("automation", automation);
    if (showTests) qs.set("test", "true");
    void api<{ runs: RunListItem[] }>(`/api/workspaces/${p.wsId}/runs?${qs.toString()}`)
      .then((r) => setRuns(r.runs))
      .catch((e) => setNotices((prev) => [...prev.slice(-19), (e as ApiError).message]));
  };

  useEffect(() => {
    void api<{ automations: { id: string; name: string }[] }>(`/api/workspaces/${p.wsId}/automations`).then((r) => setAutos(r.automations)).catch(() => undefined);
  }, [p.wsId]);

  useEffect(() => { setAutomation(initAuto); }, [initAuto]);

  useEffect(() => {
    load();
    return onEvent((ev) => { if (ev.type === "run" || ev.type === "__refetch") load(); });
  }, [p.wsId, status, automation, showTests]);

  return h("div", { class: "page runs-page" },
    h("h1", { class: "page-heading" }, "Runs"),
    h("div", { class: "filter-row" },
      h(Select, { label: "Status", value: status, options: ["All", "queued", "running", "waiting", "succeeded", "failed", "cancelled"], onChange: setStatus }),
      h(Select, { label: "Automation", value: automation, options: [{ value: "", label: "All automations" }, ...autos.map((a) => ({ value: a.id, label: a.name }))], onChange: setAutomation }),
      h(CheckBox, { label: "Show test runs", checked: showTests, onChange: setShowTests })),
    h("div", { class: "notice-region" },
      h("div", { class: "status-region", role: "status", "aria-label": "Run list results", tabIndex: -1 },
        h("p", { class: "status-line" }, `Runs shown: ${runs.length}`)),
      h(StatusLog, { name: "Notices", lines: notices })),
    runs.length === 0
      ? h("div", { class: "empty-state" }, h("div", { class: "lattice-mini" }), h("p", {}, "No runs match these filters."))
      : h("ul", { class: "run-list", "aria-label": "Runs" },
          runs.map((r) => h("li", {
            key: r.id, class: "run-row",
            "data-run-id": r.id, "data-status": r.status, "data-test": r.test ? "true" : "false",
            "data-version": r.version === null ? "" : String(r.version),
            ...(r.replay_of ? { "data-replay-of": r.replay_of } : {}),
          },
            h("a", { class: "run-link", href: `/w/${p.wsId}/runs/${r.id}`, onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${p.wsId}/runs/${r.id}`); } }, `Run #${r.number} of ${r.automation_name}`),
            StatusChip(r.status),
            r.test ? TestChip() : null,
            h("span", { class: "run-time" }, "Started " + fmtTime(r.started_at)),
            h("span", { class: "run-version" }, r.version === null ? "Draft" : "Version " + r.version)))));
}
