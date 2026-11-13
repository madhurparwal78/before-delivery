import { AlertTriangle, History } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "../components/Modal.tsx";
import { Page } from "../components/Shell.tsx";
import { WINDOW_STATUS_LABEL, api, districtTime, usePoll } from "../lib.ts";
import type { CapacityCell, Channel, DeliveryWindow, User } from "../types.ts";
import { WindowLabel } from "../components/WindowLabel.tsx";

interface Capacity {
  revision: number;
  cells: CapacityCell[];
  revisions: { revision: number; saved_at: string; saved_by: string; restored_from: number | null }[];
}

interface Conflict {
  revision: number;
  cells: CapacityCell[];
  rows: { windowId: string; label: string; typed: string; settled: string }[];
}

const capsOf = (cells: CapacityCell[]) => new Map(cells.map((c) => [c.window_id, c.cap_ml_day]));

export function CapacityTable({ channelId, user }: { channelId: string; user: User }) {
  const dispatcher = user.role === "dispatcher";
  const capacity = usePoll(() => api<Capacity>(`/api/channels/${encodeURIComponent(channelId)}/capacity`), [channelId]);
  const windows = usePoll(() => api<{ windows: DeliveryWindow[] }>(`/api/windows?channel=${encodeURIComponent(channelId)}`), [channelId]);
  const channels = usePoll(() => api<{ channels: Channel[] }>("/api/channels"), [], 30_000);
  // The base revision and its caps: set on load, on a successful save or restore and on Keep settled
  // caps, never by a live refresh. Dirty cells hold exactly what was typed until then.
  const [base, setBase] = useState<{ revision: number; caps: Map<string, string> } | null>(null);
  const [dirty, setDirty] = useState<Map<string, string>>(new Map());
  const [typedNotes, setTypedNotes] = useState<Map<string, string>>(new Map());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const restoreRefs = useRef(new Map<number, HTMLButtonElement>());

  const loaded = capacity.data;
  useEffect(() => {
    if (loaded && base === null) setBase({ revision: loaded.revision, caps: capsOf(loaded.cells) });
  }, [loaded, base]);

  const channelName = channels.data?.channels.find((c) => c.id === channelId)?.name ?? channelId;
  const rows = windows.data?.windows ?? [];
  const currentCaps = capsOf(loaded?.cells ?? []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!base) return;
    const submitted = [...dirty].map(([windowId, cap]) => ({ window_id: windowId, cap_ml_day: cap.trim() }));
    setBusy(true);
    setErrors({});
    setTypedNotes(new Map());
    setStatus("Saving.");
    const reply = await api<{ revision: number; cells: CapacityCell[] }>(`/api/channels/${encodeURIComponent(channelId)}/capacity`, {
      method: "PUT",
      body: { base_revision: base.revision, cells: submitted },
    });
    setBusy(false);
    if (reply.ok) {
      setStatus(`Revision ${reply.data.revision} saved.`);
      setBase({ revision: reply.data.revision, caps: capsOf(reply.data.cells) });
      setDirty(new Map());
    } else if (reply.error.error === "revision_conflict") {
      setStatus("Another dispatcher saved first. Each cap settled to the lower value.");
      const settled = capsOf(reply.error.cells as CapacityCell[]);
      setConflict({
        revision: reply.error.revision as number,
        cells: reply.error.cells as CapacityCell[],
        rows: (reply.error.submitted as CapacityCell[]).map((c) => ({
          windowId: c.window_id,
          label: rows.find((w) => w.id === c.window_id)?.label ?? c.window_id,
          typed: c.cap_ml_day,
          settled: settled.get(c.window_id) ?? "",
        })),
      });
    } else if (reply.error.errors) {
      setErrors(reply.error.errors);
      setStatus("Some caps could not be saved. See the notes beside them.");
    } else {
      setStatus(reply.error.message ?? "");
    }
    capacity.reload();
    windows.reload();
  };

  const keepSettled = () => {
    if (!conflict) return;
    setBase({ revision: conflict.revision, caps: capsOf(conflict.cells) });
    setDirty(new Map());
    setTypedNotes(new Map(conflict.rows.map((row) => [row.windowId, row.typed])));
    setConflict(null);
  };

  const restore = async (revision: number) => {
    setStatus("Restoring.");
    const reply = await api<{ revision: number; restored_from: number; cells: CapacityCell[] }>(
      `/api/channels/${encodeURIComponent(channelId)}/capacity/revisions/${revision}/restore`,
      { method: "POST" },
    );
    setRestoring(null);
    if (reply.ok) {
      setStatus(`Revision ${reply.data.restored_from} restored as revision ${reply.data.revision}.`);
      setBase({ revision: reply.data.revision, caps: capsOf(reply.data.cells) });
      setDirty(new Map());
      setTypedNotes(new Map());
    } else {
      setStatus(reply.error.message ?? "");
    }
    capacity.reload();
    windows.reload();
  };

  return (
    <Page title={`Capacity table: ${channelName}`} wide>
      <p className="muted">Revision {loaded?.revision ?? "…"}. Caps are in ML/day; closed windows keep their cap.</p>
      <div className="capacity-layout">
        <div className="capacity-main table-host">
          <form onSubmit={save} noValidate>
            <table className="table capacity-table" aria-label={`Capacity table ${channelName}`} role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">Window</th>
                  <th scope="col" role="columnheader" className="n">Remaining (ML)</th>
                  <th scope="col" role="columnheader" className="n">Cap (ML/day)</th>
                  <th scope="col" role="columnheader" className="n">Cap volume (ML)</th>
                  <th scope="col" role="columnheader" className="n">Committed (ML)</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((w) => {
                  const error = errors[`cells.${w.id}`];
                  const typed = typedNotes.get(w.id);
                  const typedHere = dirty.get(w.id);
                  const current = currentCaps.get(w.id);
                  return (
                    <tr key={w.id} role="row">
                      <th scope="row" role="rowheader" className="window-th">
                        <div className="window-cell">
                          <span className="window-cell-label"><WindowLabel label={w.label} /></span>{" "}
                          <span className="badges">
                            <span className="muted">{WINDOW_STATUS_LABEL[w.status]}</span>{" "}
                            {w.restriction_cap_ml_day && <span className="badge badge-alert">Restricted {w.restriction_cap_ml_day}</span>}
                          </span>{" "}
                        </div>
                      </th>
                      <td role="cell" data-label="Remaining (ML)" className="n num cell-lead">{w.remaining_ml}{" "}</td>
                      <td role="cell" data-label="Cap (ML/day)" className="n cap-col">
                        <div className="cap-cell">
                          {w.status === "closed" ? (
                            <span className="num">{current ?? w.table_cap_ml_day}</span>
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              className="num-input"
                              aria-label={`Cap for ${w.label} (ML/day)`}
                              aria-invalid={Boolean(error)}
                              readOnly={!dispatcher}
                              value={typedHere ?? current ?? ""}
                              onChange={(e) => setDirty((m) => new Map(m).set(w.id, e.target.value))}
                            />
                          )}
                          {typedHere !== undefined && current !== undefined && current !== base?.caps.get(w.id) && (
                            <span className="typed-note num">Saved cap now {current} ML/day</span>
                          )}
                          {typed && <span className="typed-note num">You typed {typed}</span>}
                          {error && <span className="field-error">{error}</span>}
                        </div>
                      </td>
                      <td role="cell" data-label="Cap volume (ML)" className="n num">{w.cap_volume_ml}{" "}</td>
                      <td role="cell" data-label="Committed (ML)" className="n num">{w.committed_ml}{" "}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {dispatcher && (
              <div className="form-actions">
                <button ref={saveRef} type="submit" className="btn btn-commit" disabled={busy || base === null}>Save table</button>
              </div>
            )}
          </form>
          <p role="status" aria-label="Capacity status" className="status-line">{status}</p>
        </div>
        <section aria-labelledby="revisions-heading" className="panel revisions-panel">
          <h2 id="revisions-heading" className="panel-title"><History size={18} aria-hidden="true" /> Revisions</h2>
          <ul aria-label="Revisions" className="rows">
            {(loaded?.revisions ?? []).map((r) => (
              <li key={r.revision} className="row-item">
                <div>
                  <p className="row-title">Revision {r.revision}{r.revision === loaded?.revision ? " (current)" : ""}</p>
                  <p className="muted">
                    {districtTime(r.saved_at)} · {r.saved_by}
                    {r.restored_from !== null && ` · restored from ${r.restored_from}`}
                  </p>
                </div>
                {dispatcher && r.revision !== loaded?.revision && (
                  <button
                    ref={(el) => {
                      if (el) restoreRefs.current.set(r.revision, el);
                    }}
                    type="button"
                    className="btn btn-quiet btn-small"
                    aria-label={`Restore revision ${r.revision}`}
                    onClick={() => setRestoring(r.revision)}
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
      {conflict && (
        <Modal role="alertdialog" labelledBy="conflict-heading" variant="alert" fullOnPhone returnFocus={saveRef} onClose={keepSettled}>
          <div className="modal-body">
            <h2 id="conflict-heading" className="modal-title alert-title">
              <AlertTriangle size={22} aria-hidden="true" />
              Capacity table conflict
            </h2>
            <p>Another dispatcher saved first. Each cap settled to the lower value.</p>
            <table className="table compare-table">
              <thead>
                <tr><th scope="col">Window</th><th scope="col" className="n">Your numbers</th><th scope="col" className="n">Settled caps</th></tr>
              </thead>
              <tbody>
                {conflict.rows.map((row) => (
                  <tr key={row.windowId}>
                    <th scope="row">{row.label}{" "}</th>
                    <td className="n num">{row.typed}{" "}</td>
                    <td className="n num">{row.settled}{" "}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-actions">
              <button type="button" className="btn btn-ink" onClick={keepSettled}>Keep settled caps</button>
            </div>
          </div>
        </Modal>
      )}
      {restoring !== null && (
        <Modal
          labelledBy="restore-heading"
          returnFocus={{ current: restoreRefs.current.get(restoring) ?? null }}
          onClose={() => setRestoring(null)}
        >
          <div className="modal-body">
            <h2 id="restore-heading" className="modal-title">Restore revision {restoring}</h2>
            <p>Restoring makes a new revision with revision {restoring}'s caps for every window that is not closed. Orders and restrictions stay as they are.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-commit" onClick={() => restore(restoring)}>Restore</button>
              <button type="button" className="btn btn-quiet" onClick={() => setRestoring(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
