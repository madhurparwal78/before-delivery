// The rail's panels: Conflicts, Charts, Changed cells and Versions.
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { type WorkbookEngine } from "../../shared/engine.js";
import { chartArea, chartTitleAllowed } from "../../shared/sheets.js";
import { ApiFailure, api } from "../api.js";
import { COPY, REASON_TEXT, SEASON_WORD, localTime } from "../copy.js";
import { type Conflict, type SeasonState, type Version } from "../types.js";
import { Dialog } from "../ui/Dialog.js";
import { FieldError } from "../ui/Icon.js";
import { notify } from "../ui/notices.js";
import { ChartFigure } from "./ChartFigure.js";
import { type Furrow } from "./furrow.js";
import { type WorkbookSession } from "./session.js";

export function ConflictsPanel({
  session,
  conflicts,
  focusFirst,
}: {
  session: WorkbookSession;
  conflicts: Conflict[];
  /** Changes whenever the "Conflicts (<n>)" button asks for focus on the first conflict. */
  focusFirst: number;
}): JSX.Element {
  const list = useRef<HTMLUListElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const focusNext = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (focusFirst > 0) list.current?.querySelector<HTMLButtonElement>("button[data-reapply]")?.focus();
  }, [focusFirst]);

  useLayoutEffect(() => {
    if (focusNext.current === null) return;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>("button[data-reapply]") ?? [];
    const next = buttons[Math.min(focusNext.current, buttons.length - 1)];
    focusNext.current = null;
    if (next) next.focus();
    else document.getElementById("rail-conflicts")?.focus();
  }, [conflicts]);

  const resolve = async (c: Conflict, index: number, choice: "reapply" | "keep_current"): Promise<void> => {
    setBusy(`${c.id}:${choice}`);
    setErrors((e) => ({ ...e, [c.id]: "" }));
    focusNext.current = index;
    try {
      await session.resolve(c, choice);
      notify(choice === "reapply" ? `Your value is back in ${c.ref}.` : `Kept the current value in ${c.ref}.`);
    } catch (err) {
      focusNext.current = null;
      const text = err instanceof ApiFailure ? (REASON_TEXT[err.code] ?? REASON_TEXT.invalid_op) : "the server could not be reached";
      setErrors((e) => ({ ...e, [c.id]: `Can't re-apply: ${text}.` }));
      notify(`Can't re-apply: ${text}.`);
    } finally {
      setBusy(null);
    }
  };

  if (!conflicts.length) return <p className="tray-empty">{COPY.emptyTray}</p>;
  return (
    <ul className="tray" aria-label="Open conflicts" ref={list}>
      {conflicts.map((c, i) => (
        <li key={c.id} className="tray-item">
          <h3>{c.ref}</h3>
          <p>
            <span className="tray-label">Yours:</span> <span className="mono">{c.myInput}</span>
          </p>
          {c.kind === "conflict" ? (
            <p>
              <span className="tray-label">Current:</span> <span className="mono">{c.currentInput}</span> by {c.currentAuthor?.name ?? "another member"}
            </p>
          ) : (
            <p>
              <span className="tray-label">Not saved:</span> {REASON_TEXT[c.reason ?? "invalid_op"]}
            </p>
          )}
          <div className="tray-actions">
            <button type="button" data-reapply className="btn btn-primary" aria-label={`Re-apply mine for ${c.ref}`} disabled={busy !== null} onClick={() => void resolve(c, i, "reapply")}>
              {busy === `${c.id}:reapply` ? "Re-applying…" : "Re-apply mine"}
            </button>
            <button type="button" className="btn btn-secondary" aria-label={`Keep current for ${c.ref}`} disabled={busy !== null} onClick={() => void resolve(c, i, "keep_current")}>
              Keep current
            </button>
          </div>
          <FieldError>{errors[c.id]}</FieldError>
        </li>
      ))}
    </ul>
  );
}

export function ChartsPanel({
  session,
  engine,
  sheetId,
  furrow,
  selectionRange,
  canBuild,
}: {
  session: WorkbookSession;
  engine: WorkbookEngine;
  sheetId: string;
  furrow: Furrow;
  selectionRange: string;
  canBuild: boolean;
}): JSX.Element {
  const [range, setRange] = useState(selectionRange);
  const [type, setType] = useState<"bar" | "line">("bar");
  const [title, setTitle] = useState("");
  const [errors, setErrors] = useState<{ range?: string; title?: string }>({});
  useSyncExternalStore(furrow.subscribe, furrow.getVersion);

  const add = (e: FormEvent): void => {
    e.preventDefault();
    const area = chartArea(engine, sheetId, range, true);
    const next = { range: area ? undefined : COPY.chartRange, title: chartTitleAllowed(title) ? undefined : COPY.chartTitle };
    setErrors(next);
    if (!area || next.title) return;
    session.addChart(sheetId, area, type, title);
    setTitle("");
  };

  const charts = engine.charts.filter((c) => c.sheetId === sheetId);
  return (
    <div className="charts-panel">
      {canBuild && (
        <form className="chart-builder" onSubmit={add} noValidate>
          <label className="field">
            <span>Chart range</span>
            <input value={range} onChange={(e) => setRange(e.target.value)} spellCheck={false} className="mono" />
          </label>
          <FieldError>{errors.range}</FieldError>
          <div role="radiogroup" aria-label="Chart type" className="radios">
            {(["bar", "line"] as const).map((t) => (
              <label key={t} className="radio">
                <input type="radio" name="chart-type" checked={type === t} onChange={() => setType(t)} />
                <span>{t === "bar" ? "Bar" : "Line"}</span>
              </label>
            ))}
          </div>
          <label className="field">
            <span>Chart title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <FieldError>{errors.title}</FieldError>
          <button type="submit" className="btn btn-primary">
            Add chart
          </button>
        </form>
      )}
      {charts.length === 0 && <p className="muted">No charts on this sheet yet.</p>}
      {charts.map((c) => (
        <ChartFigure
          key={c.id}
          title={c.title}
          type={c.type}
          data={engine.chartData(c)}
          live={furrow.chartValues.get(c.id)}
          onRemove={canBuild ? () => session.removeChart(c.id) : undefined}
        />
      ))}
    </div>
  );
}

export function ChangedPanel({ furrow }: { furrow: Furrow }): JSX.Element {
  useSyncExternalStore(furrow.subscribe, furrow.getVersion);
  if (!furrow.changedLines.length) return <p className="muted">Commit an edit to see the cells it recalculated, in the order they changed.</p>;
  return (
    <ul className="changed" aria-label="Changed cells">
      {furrow.changedLines.map((line) => (
        <li key={line} className="mono">
          {line}
        </li>
      ))}
    </ul>
  );
}

export function VersionsPanel({
  workbookId,
  zone,
  canRestore,
  state,
  onRestored,
}: {
  workbookId: string;
  zone: string;
  canRestore: boolean;
  state: SeasonState;
  onRestored(): void;
}): JSX.Element {
  const [versions, setVersions] = useState<Version[]>([]);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Version | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ versions: Version[] }>(`/api/workbooks/${workbookId}/versions`)
      .then((r) => setVersions(r.versions))
      .catch(() => undefined);
  }, [workbookId]);
  useEffect(load, [load]);

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (label.length < 1 || label.length > 60) {
      setError(COPY.versionLabel);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const r = await api.post<{ version: Version }>(`/api/workbooks/${workbookId}/versions`, { label });
      notify(`Version ${r.version.number} saved.`);
      setLabel("");
      load();
    } catch (err) {
      notify(err instanceof ApiFailure && err.status === 503 ? COPY.storageVersions : "The version wasn't saved. Try again.");
      if (err instanceof ApiFailure && err.fields.label) setError(COPY.versionLabel);
    } finally {
      setSaving(false);
    }
  };

  const restoreError = (err: unknown): string => {
    if (err instanceof ApiFailure && err.status === 503) return COPY.storageVersions;
    if (err instanceof ApiFailure && err.status === 409) return `That isn't allowed while the workbook is ${SEASON_WORD[state]}.`;
    return "The restore didn't finish. Try again.";
  };

  const undo = async (version: Version): Promise<void> => {
    try {
      const r = await api.post<{ restored: Version }>(`/api/workbooks/${workbookId}/versions/${version.id}/restore`);
      notify(`Restore undone as version ${r.restored.number}.`);
      onRestored();
      load();
    } catch (err) {
      notify(restoreError(err));
    }
  };

  const restore = async (): Promise<void> => {
    const target = confirm as Version;
    setRestoring(true);
    try {
      const r = await api.post<{ restored: Version; undo: Version }>(`/api/workbooks/${workbookId}/versions/${target.id}/restore`);
      setConfirm(null);
      notify(`Restored version ${target.number} as version ${r.restored.number}.`, { label: "Undo restore", run: () => void undo(r.undo) });
      onRestored();
      load();
    } catch (err) {
      setConfirm(null);
      notify(restoreError(err));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="versions-panel">
      <form className="version-save" onSubmit={(e) => void save(e)} noValidate>
        <label className="field">
          <span>Version label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save version"}
        </button>
      </form>
      <FieldError>{error}</FieldError>
      <ul className="versions" aria-label="Versions">
        {versions.map((v) => (
          <li key={v.id}>
            <span className="version-line">
              Version <span className="mono">{v.number}</span> · {v.label} · <span className="mono">{localTime(v.createdAt, zone)}</span> · {v.createdBy.name}
            </span>
            {canRestore && (
              <button type="button" className="btn btn-secondary" aria-label={`Restore version ${v.number}`} onClick={() => setConfirm(v)}>
                Restore
              </button>
            )}
          </li>
        ))}
      </ul>
      {confirm && (
        <Dialog title={`Restore version ${confirm.number}?`} role="alertdialog" onClose={() => setConfirm(null)}>
          <p>
            Every sheet, cell, format and chart goes back to version {confirm.number}. The current state is saved first, so you can undo the restore.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={restoring} onClick={() => void restore()}>
              {restoring ? "Restoring…" : "Restore"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
