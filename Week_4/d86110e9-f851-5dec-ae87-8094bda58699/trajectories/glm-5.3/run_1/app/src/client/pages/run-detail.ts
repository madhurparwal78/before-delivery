// Run detail: summary column, canvas (wide) or step list (narrow), step log
// dialog, cancel and replay controls, live updates.

import { h } from "../runtime";
import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { api, fmtTime, navigate, onEvent } from "../runtime";
import type { RunDetail, StepRec, Me } from "../runtime";
import type { ApiError } from "../runtime";
import { Btn, Select, StatusChip, StatusLog, TestChip } from "../ui";
import { Canvas, kindLabel } from "../canvas";

export function RunDetailPage(p: { me: Me | null; wsId: string; rid: string; narrow: boolean }): VNode {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const viewer = p.me?.workspaces.find((w) => w.id === p.wsId)?.role === "viewer";

  const load = () => {
    void api<RunDetail>(`/api/workspaces/${p.wsId}/runs/${p.rid}`).then(setRun).catch((e) => {
      const err = e as ApiError;
      if (err.status === 404) navigate("/not-found");
    });
  };
  useEffect(() => {
    load();
    return onEvent((ev) => { if (ev.type === "run" || ev.type === "__refetch") load(); });
  }, [p.wsId, p.rid]);

  const notice = (s: string) => setNotices((prev) => [...prev.slice(-19), s]);

  const cancel = async () => {
    setBusy("cancel");
    try {
      await api(`/api/workspaces/${p.wsId}/runs/${p.rid}/cancel`, { method: "POST" });
      load();
    } catch (e) {
      notice((e as ApiError).message);
    } finally { setBusy(null); }
  };

  const replay = async (fromStep: string) => {
    setBusy("replay");
    try {
      const r = await api<{ run_id: string; number: number }>(`/api/workspaces/${p.wsId}/runs/${p.rid}/replay`, {
        method: "POST", body: JSON.stringify({ from_step: fromStep }),
      });
      navigate(`/w/${p.wsId}/runs/${r.run_id}`);
    } catch (e) {
      notice((e as ApiError).message);
    } finally { setBusy(null); }
  };

  if (!run) return h("div", { class: "page" }, h("h1", { class: "page-heading" }, "Run"));
  void viewer;

  const failedStep = run.steps.find((s) => s.status === "failed");
  const inLoop = (id: string): boolean => {
    // steps inside a loop each-part: derive from edges
    const loopIds = run.steps.filter((s) => s.kind === "loop").map((s) => s.id);
    for (const lid of loopIds) {
      const seen = new Set<string>([lid]);
      const stack: string[] = [];
      run.edges.filter((e) => e.from === lid && e.port === "each").forEach((e) => stack.push(e.to));
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === id) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        run.edges.filter((e) => e.from === cur).forEach((e) => stack.push(e.to));
      }
    }
    return false;
  };
  const replayChoices = failedStep
    ? run.steps.filter((s) => s.ord <= failedStep.ord && !(s.id !== "trigger" && inLoop(s.id)))
    : [];
  const [replayFrom, setReplayFrom] = useState("");
  useEffect(() => { if (replayChoices.length && replayFrom === "") setReplayFrom(replayChoices[replayChoices.length - 1].id); }, [failedStep?.id]);

  const summary = h("div", { class: "run-summary", role: "region", "aria-label": "Run summary",
      "data-run-id": run.id, "data-status": run.status, "data-test": run.test ? "true" : "false",
      "data-version": run.version === null ? "" : String(run.version),
      ...(run.replay_of ? { "data-replay-of": run.replay_of } : {}) },
    h("h1", { class: "page-heading" }, `Run #${run.number} of ${run.automation_name}`),
    StatusChip(run.status),
    run.test ? TestChip() : null,
    h("p", { class: "run-meta" }, run.version === null ? "Draft" : "Version " + run.version),
    h("p", { class: "run-meta" }, "Started " + fmtTime(run.started_at)),
    run.finished_at ? h("p", { class: "run-meta" }, "Finished " + fmtTime(run.finished_at)) : null,
    run.message ? h("p", { class: "run-message" }, run.message) : null,
    run.replay_of ? h("p", { class: "run-meta" }, h("a", { class: "link-action", href: `/w/${p.wsId}/runs/${run.replay_of}`, onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${p.wsId}/runs/${run.replay_of}`); } }, `Replay of run ${run.replay_of}`)) : null,
    h("div", { class: "run-actions" },
      h(Btn, {
        onClick: () => void cancel(),
        disabled: viewer || !["queued", "running", "waiting"].includes(run.status) || busy === "cancel",
      }, busy === "cancel" ? "Working..." : "Cancel run"),
      failedStep ? h("span", { class: "replay-group" },
        h(Select, { label: "Replay from", value: replayFrom, options: replayChoices.map((s) => ({ value: s.id, label: s.name })), onChange: setReplayFrom }),
        h(Btn, { kind: "primary", onClick: () => void replay(replayFrom), disabled: viewer || busy === "replay" }, busy === "replay" ? "Working..." : "Replay")) : null));

  const statusOf = (id: string) => run.steps.find((s) => s.id === id)?.status;
  const reusedOf = (id: string) => run.steps.find((s) => s.id === id)?.reused;
  const triggerRec = {
    id: "trigger" as const, kind: run.steps[0]?.kind ?? "form", name: run.steps[0]?.name ?? "Trigger",
    col: run.steps[0]?.col ?? 1, row: run.steps[0]?.row ?? 2,
    fields: {}, sample: {},
  };
  const stepDrafts = run.steps.slice(1).map((s) => ({ id: s.id, kind: s.kind, name: s.name, col: s.col, row: s.row, fields: {} }));

  return h("div", { class: "page run-detail-page" },
    h("div", { class: "run-detail-grid" },
      summary,
      p.narrow
        ? h("ol", { class: "step-list", "aria-label": "Steps" },
            run.steps.map((s) => h("li", {
              key: s.id, class: "step-item", tabIndex: 0,
              "data-step-id": s.id, "data-kind": s.kind, "data-col": String(s.col), "data-row": String(s.row),
              "data-status": s.status, "data-reused": s.reused ? "true" : "false", "data-anim": s.status === "running" ? "running" : "none",
              onClick: () => setLogId(s.id),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLogId(s.id); }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const items = Array.from(document.querySelectorAll<HTMLElement>(".step-list .step-item"));
                  const idx = items.indexOf(e.currentTarget as HTMLElement);
                  const next = items[(idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
                  next?.focus();
                }
              },
            },
              h("button", { class: "step-btn" }, s.name),
              h("span", { class: "step-kind-label" }, kindLabel(s.kind)),
              StatusChip(s.status))))
        : h("div", { class: "canvas-panel" },
            h(Canvas, {
              trigger: triggerRec, steps: stepDrafts, edges: run.edges,
              statusOf, reusedOf,
              focusId: "", onFocus: () => undefined,
              onOpen: (id: string) => setLogId(id),
            }))),
    h("div", { class: "notice-region" }, h(StatusLog, { name: "Notices", lines: notices })),
    logId ? h(StepLogDialog, { run, sid: logId, onClose: () => { const was = logId; setLogId(null); setTimeout(() => { (document.querySelector(`[data-step-id="${was}"]`) as HTMLElement | null)?.focus(); }, 0); } }) : null);
}

function StepLogDialog(p: { run: RunDetail; sid: string; onClose: () => void }): VNode {
  const s = p.run.steps.find((x) => x.id === p.sid)!;
  const json = (v: unknown): string => JSON.stringify(v ?? {}, null, 2);
  return h("div", { class: "dialog-backdrop", onMouseDown: (e: MouseEvent) => { if (e.target === e.currentTarget) p.onClose(); } },
    h("div", {
      class: "dialog step-log", role: "dialog", "aria-label": `Step log: ${s.name}`, "aria-modal": "true",
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Escape") { e.preventDefault(); p.onClose(); }
        if (e.key === "Tab") {
          const focusables = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button,[tabindex='0']");
          if (focusables.length === 0) return;
          const first = focusables[0], last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      },
    },
      h("h2", { class: "dialog-heading" }, `Step log: ${s.name}`),
      h("div", { class: "log-group", role: "group", "aria-label": "Status" },
        h("p", { class: "log-line" }, "Status"), h("p", { class: "log-line" }, s.status)),
      h("div", { class: "log-group", role: "group", "aria-label": "Input" },
        h("p", { class: "log-line" }, "Input"), h("pre", { class: "log-json" }, json(s.input))),
      h("div", { class: "log-group", role: "group", "aria-label": "Output" },
        h("p", { class: "log-line" }, "Output"), h("pre", { class: "log-json" }, json(s.output))),
      h("div", { class: "log-group", role: "group", "aria-label": "Log" },
        s.log.length === 0 ? h("p", { class: "log-line" }, "(no lines)") :
          h("ul", { class: "log-list", "aria-label": "Log" }, s.log.map((l, i) => h("li", { key: i }, l)))),
      h("div", { class: "log-group", role: "group", "aria-label": "Attempts" },
        h("p", { class: "log-line" }, `Attempts: ${s.attempts}`)),
      h("div", { class: "log-group", role: "group", "aria-label": "Timing" },
        h("p", { class: "log-line" }, "Started: " + fmtTime(s.started_at)),
        s.finished_at ? h("p", { class: "log-line" }, "Finished: " + fmtTime(s.finished_at)) : null,
        s.due_at ? h("p", { class: "log-line" }, "Due: " + fmtTime(s.due_at)) : null,
        s.retry_at ? h("p", { class: "log-line" }, "Retry at: " + fmtTime(s.retry_at)) : null),
      h("div", { class: "dialog-actions" },
        h(Btn, { onClick: p.onClose }, "Close"))));
}
