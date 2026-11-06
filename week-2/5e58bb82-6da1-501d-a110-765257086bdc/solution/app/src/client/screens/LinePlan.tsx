// The line plan: assign every line and crossline to a vessel, select many and assign them at once (with
// a ten-second undo), keep unsaved picker changes across a reload, and launch the mission.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, NoResponse, Stale, type Line, type Mission, type Vessel } from "../api";
import { Dialog } from "../components/Dialog";
import { VesselCombobox, type Choice } from "../components/VesselCombobox";
import { usePoll } from "../hooks";
import { follow, setLeaveGuard } from "../router";
import { useSession } from "../session";
import { length } from "../units";
import { NotFound } from "./NotFound";

const KIND: Record<Line["kind"], string> = { planned: "Planned", crossline: "Crossline", infill: "Infill" };
const ORDER: Record<string, string> = { special: "Special Order", "1a": "Order 1a" };
const assignable = (l: Line) => l.status === "Pending" || l.status === "Assigned";
const storeKey = (id: string) => `swathdeck.unsaved.${id}`;

export function LinePlan({ missionId }: { missionId: string }) {
  const { user } = useSession();
  const [mission, setMission] = useState<Mission | null | undefined>(undefined);
  const [lines, setLines] = useState<Line[]>([]);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [unsaved, setUnsaved] = useState<Record<string, string | null>>(() => JSON.parse(sessionStorage.getItem(storeKey(missionId)) ?? "{}"));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [undoable, setUndoable] = useState<{ previous: Record<string, string | null>; count: number } | null>(null);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const anchor = useRef<number | null>(null);
  const restored = useRef(false);

  const load = usePoll(async () => {
    const [m, l, v] = await Promise.all([api<Mission>(`/api/missions/${missionId}`), api<Line[]>(`/api/missions/${missionId}/lines`), api<Vessel[]>("/api/vessels")]);
    if (m.status === 404) return setMission(null);
    if (m.ok) setMission(m.data);
    if (l.ok) setLines(l.data);
    if (v.ok) setVessels(v.data);
  }, 5000, [missionId]);

  useEffect(() => {
    const n = Object.keys(unsaved).length;
    if (n) sessionStorage.setItem(storeKey(missionId), JSON.stringify(unsaved));
    else sessionStorage.removeItem(storeKey(missionId));
    setLeaveGuard(n ? (go) => {
      setLeaving(() => go);
      return false;
    } : null);
    return () => setLeaveGuard(null);
  }, [unsaved, missionId]);

  useEffect(() => {
    if (restored.current || !lines.length) return;
    restored.current = true;
    const n = Object.keys(unsaved).length;
    if (n) setStatus(`Unsaved changes restored (${n})`);
  }, [lines, unsaved]);

  if (mission === null) return <NotFound />;
  if (!mission) return <main className="page"><p className="muted">Loading line plan…</p></main>;

  const choices: Choice[] = [{ value: null, label: "Unassigned" }, ...vessels.map((v) => ({ value: v.id, label: v.name }))];
  const vesselOf = (l: Line) => (l.id in unsaved ? unsaved[l.id] : l.vessel_id);
  const isOwner = mission.owner_id === user.id;

  const pick = (l: Line, value: string | null) => {
    setUnsaved((u) => {
      const next = { ...u };
      if (value === l.vessel_id) delete next[l.id];
      else next[l.id] = value;
      return next;
    });
  };

  const post = async (entries: Record<string, string | null>) =>
    api<Line[]>(`/api/missions/${mission.id}/assignments`, { method: "POST", body: { assignments: Object.entries(entries).map(([line_id, vessel_id]) => ({ line_id, vessel_id })) } });

  const save = async () => {
    if (busy) return;
    const entries = { ...unsaved };
    if (!Object.keys(entries).length) {
      setStatus("Assignments saved");
      return;
    }
    setBusy(true);
    setStatus("Saving assignments");
    try {
      const r = await post(entries);
      if (r.ok) {
        const updated = new Map(r.data.map((l) => [l.id, l]));
        setLines((ls) => ls.map((l) => updated.get(l.id) ?? l));
        setUnsaved({});
        setStatus("Assignments saved");
        load();
      } else setStatus(r.error?.message ?? "Assignments not saved");
    } catch (e) {
      if (e instanceof NoResponse) setStatus("Could not reach Swathdeck — the assignments are not saved yet");
      else if (!(e instanceof Stale)) throw e;
    } finally {
      setBusy(false);
    }
  };

  const launch = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("Launching mission");
    try {
      const r = await api<Mission>(`/api/missions/${mission.id}/transitions`, { method: "POST", body: { to: "Launched" } });
      if (r.ok) {
        setMission(r.data);
        setStatus("Mission launched");
      } else setStatus(r.error?.message ?? "Mission not launched");
    } catch (e) {
      if (e instanceof NoResponse) setStatus("Could not reach Swathdeck — the mission is not launched yet");
      else if (!(e instanceof Stale)) throw e;
    } finally {
      setBusy(false);
    }
  };

  const announceSelection = (next: Set<string>) => {
    setSelected(next);
    setStatus(`${next.size} lines selected`);
  };

  const rowIds = lines.map((l) => l.id);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    anchor.current = rowIds.indexOf(id);
    announceSelection(next);
  };

  const onTableKey = (e: React.KeyboardEvent) => {
    const row = (e.target as HTMLElement).closest("tr[data-line]") as HTMLElement | null;
    const id = row?.dataset.line;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      announceSelection(new Set(lines.filter(assignable).map((l) => l.id)));
      return;
    }
    if (!id) return;
    if (e.key === " " && e.target === row) {
      e.preventDefault();
      toggle(id);
    } else if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const here = rowIds.indexOf(id);
      const there = Math.max(0, Math.min(rowIds.length - 1, here + (e.key === "ArrowDown" ? 1 : -1)));
      const from = anchor.current ?? here;
      const [a, b] = [Math.min(from, there), Math.max(from, there)];
      announceSelection(new Set([...selected, ...rowIds.slice(a, b + 1)]));
      anchor.current = from;
      table.current?.querySelector<HTMLElement>(`tr[data-line="${rowIds[there]}"]`)?.focus();
    }
  };

  const bulkAssign = async (vesselId: string) => {
    const ids = [...selected];
    const previous = Object.fromEntries(ids.map((id) => [id, lines.find((l) => l.id === id)?.vessel_id ?? null]));
    const vesselName = vessels.find((v) => v.id === vesselId)?.name ?? "";
    setBulkOpen(false);
    setStatus("Saving assignments");
    try {
      const r = await post(Object.fromEntries(ids.map((id) => [id, vesselId])));
      if (!r.ok) {
        setStatus(r.error?.message ?? "Assignments not saved");
        return;
      }
      setUnsaved((u) => Object.fromEntries(Object.entries(u).filter(([id]) => !ids.includes(id))));
      setUndoable({ previous, count: ids.length });
      setStatus(`Assigned ${ids.length} lines to ${vesselName} — Undo available for 10 seconds`);
      load();
    } catch (e) {
      if (e instanceof NoResponse) setStatus("Could not reach Swathdeck — the assignments are not saved yet");
      else if (!(e instanceof Stale)) throw e;
    }
  };

  const undoBulk = async () => {
    if (!undoable) return;
    const { previous, count } = undoable;
    setUndoable(null);
    try {
      const r = await post(previous);
      setStatus(r.ok ? `Undid assignment of ${count} lines` : `Could not undo: ${r.error?.message ?? ""}`);
      load();
    } catch (e) {
      if (e instanceof NoResponse) setStatus("Could not undo: Swathdeck could not be reached");
      else if (!(e instanceof Stale)) throw e;
    }
  };

  const changed = Object.keys(unsaved).length;
  return (
    <main className="page">
      <h1>{mission.name}</h1>
      <div role="group" aria-label="Plan summary" className="groups plan-summary">
        <div><span className="caption">Survey order</span> <span>{ORDER[mission.survey_order]}</span></div>
        <div><span className="caption">Lines</span> <span className="num">{mission.line_count}</span></div>
        <div><span className="caption">Crosslines</span> <span className="num">{mission.crossline_count}</span></div>
        <div><span className="caption">Estimated duration</span> <span className="num">{Math.round(mission.estimated_duration_s / 60)} min</span></div>
        <div><span className="caption">Swath width</span> <span className="num">{length(mission.swath_width_m, user.units)}</span></div>
        <div><span className="caption">Line spacing</span> <span className="num">{length(mission.line_spacing_m, user.units)}</span></div>
      </div>
      <div className="row">
        <button type="button" disabled={!selected.size} onClick={() => setBulkOpen(true)}>Assign selected</button>
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>Save assignments</button>
        <p role="status" aria-live="polite" aria-label="Plan status">{status}</p>
        {undoable && <UndoButton onUndo={() => void undoBulk()} onExpire={() => setUndoable(null)} />}
      </div>
      <div className="table-scroll plan-table" tabIndex={0} role="region" aria-label="Line plan table">
        <table ref={table} aria-label="Line plan" onKeyDown={onTableKey}>
          <thead><tr><th><span className="sr-only">Select</span></th><th>Line</th><th>Kind</th><th>Length</th><th>Vessel</th><th><span className="sr-only">Changes</span></th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} data-line={l.id} tabIndex={-1} aria-selected={selected.has(l.id)}>
                <td><input type="checkbox" aria-label={`Select ${l.label}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} /></td>
                <td>{l.label}</td>
                <td>{KIND[l.kind]}</td>
                <td className="num">{length(l.length_m, user.units)}</td>
                <td>
                  <VesselCombobox label={`Vessel for ${l.label}`} value={vesselOf(l)} choices={choices} disabled={!assignable(l)}
                    onChange={(value) => pick(l, value)} />
                </td>
                <td>{l.id in unsaved ? "Unsaved" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button type="button" disabled={busy || !isOwner || mission.status !== "Planned"} onClick={() => void launch()}>Launch mission</button>
        <a href={`/missions/${mission.id}`} onClick={(e) => { e.preventDefault(); follow(`/missions/${mission.id}`); }}>Open console</a>
        {!isOwner && <span className="owner-note">Owned by {mission.owner_name}</span>}
      </div>
      {bulkOpen && <BulkDialog count={selected.size} vessels={vessels} onClose={() => setBulkOpen(false)} onConfirm={(id) => void bulkAssign(id)} />}
      {leaving && (
        <Dialog label="Unsaved assignments" onClose={() => setLeaving(null)} initialFocus="[data-stay]">
          <h2>Unsaved assignments</h2>
          <p>You have {changed} unsaved assignment changes.</p>
          <div className="actions">
            <button type="button" data-stay className="primary" onClick={() => setLeaving(null)}>Stay</button>
            <button type="button" onClick={() => {
              const go = leaving;
              sessionStorage.removeItem(storeKey(mission.id));
              setLeaveGuard(null);
              setLeaving(null);
              go();
            }}>Leave without saving</button>
          </div>
        </Dialog>
      )}
    </main>
  );
}

function UndoButton({ onUndo, onExpire }: { onUndo: () => void; onExpire: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onExpire, 10_000);
    return () => window.clearTimeout(timer);
  }, []);
  return <button type="button" onClick={onUndo}>Undo</button>;
}

function BulkDialog({ count, vessels, onClose, onConfirm }: { count: number; vessels: Vessel[]; onClose: () => void; onConfirm: (vesselId: string) => void }) {
  const [vessel, setVessel] = useState(vessels[0]?.id ?? "");
  const select = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => select.current?.focus(), []);
  return (
    <Dialog label="Assign selected lines" onClose={onClose}>
      <h2>Assign selected lines</h2>
      <p>{count} lines will move to one vessel in a single save.</p>
      <div className="field">
        <label htmlFor="bulk-vessel">Vessel</label>
        <select ref={select} id="bulk-vessel" value={vessel} onChange={(e) => setVessel(e.target.value)}>
          {vessels.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => onConfirm(vessel)}>Assign</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
