// Stock audit: walk the tray cell by cell, record a missing item through "Record missing item",
// and queue marks while offline; on reconnect they replay once each, in recorded order.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { F, syncLimit } from "../../shared/feedback";
import { CELLS, CELL_COLUMNS, type Cell } from "../../shared/limits";
import { draftKey } from "../../shared/drafts";
import type { AuditMarkRequest, SyncResult } from "../../shared/types";
import { api } from "../api";
import { newCommandId } from "../commands";
import { limits } from "../config";
import { useDesk } from "../desk";
import { useDraft } from "../drafts";
import { CELL_SIZE, FactBoxes, HolderShape, label, Workspace } from "../parts";
import { Review } from "../Review";

export function Audit() {
  const { ns, state, online, send, announce, refresh } = useDesk();
  const [selected, setSelected] = useState<Cell>("A1");
  const [queue, setQueue] = useDraft<AuditMarkRequest[]>(draftKey(ns, "audit", "queue"), []);
  const [conflicts, setConflicts] = useDraft<AuditMarkRequest[]>(draftKey(ns, "audit", "conflicts"), []);
  const [reviewing, setReviewing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const syncing = useRef(false);
  const cells = useRef(new Map<Cell, HTMLButtonElement>());
  const swipe = useRef<{ x: number; pointer: number } | null>(null);
  const index = CELLS.indexOf(selected);

  const sync = useCallback(async () => {
    if (syncing.current || queue.length === 0 || !navigator.onLine) return;
    syncing.current = true;
    setSyncFailed(false);
    announce(F.PENDING);
    let remaining = queue;
    while (remaining.length > 0) {
      const batch = remaining.slice(0, limits.FLAN_SYNC_BATCH_MAX);
      const reply = await api<{ results: SyncResult[] }>("POST", `/api/desks/${ns}/audit/sync`, { commands: batch });
      if (!reply.ok) {
        announce(reply.status === 0 && !navigator.onLine ? F.OFFLINE : "");
        setSyncFailed(true);
        syncing.current = false;
        return;
      }
      const stale: AuditMarkRequest[] = [];
      for (const [i, result] of reply.body.results.entries()) {
        if (result.status === 200) announce(F.AUDIT_MISSING);
        else stale.push(batch[i]!);
      }
      setConflicts((c) => [...c, ...stale]);
      remaining = remaining.slice(batch.length);
      setQueue(remaining);
    }
    await refresh();
    announce(F.SYNCED);
    syncing.current = false;
  }, [queue, ns, announce, refresh, setConflicts, setQueue]);

  useEffect(() => {
    if (online && queue.length > 0 && !syncFailed) void sync();
  }, [online, queue.length, syncFailed, sync]);

  if (!state) return null;
  const cell = state.tray[selected];
  const occupant = cell?.specimen ?? null;

  const select = (next: number) => {
    const target = CELLS[Math.min(CELLS.length - 1, Math.max(0, next))]!;
    setSelected(target);
    return target;
  };
  const onTrayKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: index + CELL_COLUMNS, ArrowUp: index - CELL_COLUMNS };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const proposed = moves[event.key]!;
    if (proposed < 0 || proposed >= CELLS.length) return;
    const target = select(proposed);
    cells.current.get(target)?.focus();
  };

  const confirm = async () => {
    const queuedOnCell = queue.filter((q) => q.cell === selected).length;
    const expected = (cell?.audit_version ?? 0) + queuedOnCell;
    const mark: AuditMarkRequest = { command_id: newCommandId(), expected_version: expected, cell: selected, mark: "missing" };
    const request = { kind: "mark" as const, method: "POST" as const, path: "/audit/marks", body: { ...mark }, commandId: mark.command_id };
    if (!navigator.onLine || queue.length > 0) {
      setQueue((q) => [...q, mark]);
      announce(navigator.onLine ? F.PENDING : F.OFFLINE);
      return "close" as const;
    }
    await send(request);
    return "close" as const;
  };

  return (
    <Workspace name="Stock audit workspace" heading="Stock audit · Crown tray 1" list="stock" className="ws-audit" facts={occupant && <FactBoxes specimenKey={occupant} specimen={state.specimens[occupant]} />}>
      <div className="area-tray tray-box">
        <div
          className="tray-grid audit-grid"
          role="group"
          aria-label="Audit tray"
          style={{ gridTemplateColumns: `repeat(${CELL_COLUMNS}, minmax(44px, ${CELL_SIZE}))` }}
          onKeyDown={onTrayKey}
          onPointerDown={(e) => (swipe.current = { x: e.clientX, pointer: e.pointerId })}
          onPointerUp={(e) => {
            const start = swipe.current;
            swipe.current = null;
            if (!start || start.pointer !== e.pointerId) return;
            const dx = e.clientX - start.x;
            if (Math.abs(dx) > 40) select(index + (dx < 0 ? 1 : -1));
          }}
        >
          {CELLS.map((name) => {
            const inCell = state.tray[name]?.specimen ?? null;
            const missing = state.tray[name]?.audit_mark === "missing";
            return (
              <button
                key={name}
                ref={(el) => {
                  if (el) cells.current.set(name, el);
                }}
                type="button"
                className={missing ? "tray-cell missing" : "tray-cell"}
                aria-pressed={selected === name}
                tabIndex={selected === name ? 0 : -1}
                style={{ aspectRatio: "1" }}
                onClick={() => setSelected(name)}
              >
                <span className="sr-only">{`Cell ${name}`}</span>
                <span className="cell-name figures" aria-hidden="true">{name}</span>
                {inCell && state.specimens[inCell] && <HolderShape holder={state.specimens[inCell]!.holder} mintmark={state.specimens[inCell]!.attribution.mintmark} />}
                <span className="cell-caption" aria-hidden="true">{inCell ? `${label(inCell)}${missing ? " · missing" : ""}` : "Empty"}</span>
              </button>
            );
          })}
        </div>
        <div className="cell-steps">
          <button type="button" className="button quiet" disabled={index === 0} onClick={() => select(index - 1)}>
            Previous cell
          </button>
          <button type="button" className="button quiet" disabled={index === CELLS.length - 1} onClick={() => select(index + 1)}>
            Next cell
          </button>
        </div>
      </div>
      <div className="area-facts fact-box cell-facts">
        <h2>{`Cell ${selected}:`}</h2>
        <ul className="figures">
          <li>{occupant ? `Holds ${label(occupant)}.` : "Empty cell."}</li>
          <li>{cell?.audit_mark === "missing" ? "Marked missing." : "Not marked missing."}</li>
          <li>{`Audit version ${cell?.audit_version ?? 0}; ${state.audit_events.filter((e) => e.cell === selected).length} marks in its history.`}</li>
        </ul>
        {queue.length > 0 && (
          <div className="note">
            {syncFailed && online && (
              <button type="button" className="action-link" onClick={() => void sync()}>
                Retry sync
              </button>
            )}
            <p>{online ? `${queue.length} queued marks are waiting to sync.` : F.OFFLINE}</p>
            <ol className="figures">
              {queue.map((q) => (
                <li key={q.command_id}>{`Cell ${q.cell} missing`}</li>
              ))}
            </ol>
          </div>
        )}
        {queue.length === 0 && !online && (
          <div className="note">
            <p>{F.OFFLINE}</p>
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="note">
            <button
              type="button"
              className="action-link"
              onClick={() => {
                setConflicts([]);
                void refresh();
              }}
            >
              Reload current
            </button>
            <p>{F.CONFLICT}</p>
            <ul className="figures">
              {conflicts.map((c) => (
                <li key={c.command_id}>{`Cell ${c.cell}: a newer change was kept.`}</li>
              ))}
            </ul>
          </div>
        )}
        {queue.length > limits.FLAN_SYNC_BATCH_MAX && <p className="caption-text">{syncLimit(limits.FLAN_SYNC_BATCH_MAX)}</p>}
      </div>
      <div className="area-review actions">
        <button type="button" className="button primary" onClick={() => setReviewing(true)}>
          Mark missing
        </button>
      </div>
      {reviewing && (
        <Review
          label="Record missing item"
          onClose={() => setReviewing(false)}
          onConfirm={confirm}
          summary={
            <p>
              Records {occupant ? <strong>{label(occupant)}</strong> : "the item"} in <strong>Cell {selected}</strong> as missing. Audit history is kept.
              {!online && " You are offline, so the mark is queued."}
            </p>
          }
        />
      )}
    </Workspace>
  );
}
