import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { AccountShell, useFacilitator } from "../account.js";
import { instantDateTime } from "../format.js";
import { useTitle } from "../ui.js";
import { ACTIVITY_LABELS } from "../../shared/copy.js";
import { STATUS_LABELS, enteredBefore, type Status } from "../../shared/states.js";
import type { FacilitatorWorkshop } from "../types.js";

interface Entry {
  id: string;
  seq: number;
  at: string;
  actor: "facilitator" | "system";
  action: string;
  workshopId: string | null;
}

/**
 * Walking a workshop's transition entries from newest to oldest, each one entered the state before the one
 * above it. The walk starts from the workshop's current status and round count.
 */
interface Walk {
  next: Status;
  rounds: number;
}

export function Activity() {
  useTitle("Activity log");
  const me = useFacilitator();
  const [entries, setEntries] = useState<(Entry & { label: string })[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const titles = useRef(new Map<string, string>());
  const walks = useRef(new Map<string, Walk>());
  const focusFrom = useRef<number | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const label = (e: Entry): string => {
    if (e.action !== "workshop.transitioned" || !e.workshopId) return ACTIVITY_LABELS[e.action] ?? e.action;
    const walk = walks.current.get(e.workshopId);
    if (!walk) return ACTIVITY_LABELS[e.action] ?? e.action;
    const entered = walk.next;
    const before = enteredBefore(entered, walk.rounds);
    walks.current.set(e.workshopId, { next: before.status, rounds: before.rounds });
    return `Moved to ${STATUS_LABELS[entered]}`;
  };

  const load = async (after: string | null) => {
    setBusy(true);
    try {
      const r = await api<{ entries: Entry[]; nextCursor: string | null }>("GET", `/api/activity${after ? `?cursor=${encodeURIComponent(after)}` : ""}`);
      const labelled = r.entries.map((e) => ({ ...e, label: label(e) }));
      setEntries((old) => {
        focusFrom.current = after ? old.length : null;
        return [...old, ...labelled];
      });
      setCursor(r.nextCursor);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  };

  useEffect(() => {
    api<{ workshops: FacilitatorWorkshop[] }>("GET", "/api/workshops")
      .then((r) => {
        for (const w of r.workshops) {
          titles.current.set(w.id, w.title);
          walks.current.set(w.id, { next: w.status, rounds: w.roundsUsed });
        }
      })
      .catch(() => undefined)
      .finally(() => void load(null));
  }, []);

  useLayoutEffect(() => {
    if (focusFrom.current === null) return;
    list.current?.querySelectorAll<HTMLElement>("li")[focusFrom.current]?.focus();
    focusFrom.current = null;
  }, [entries]);

  const zone = me?.timeZone ?? "UTC";
  return (
    <AccountShell>
      <main className="column">
        <h1 className="display-sm">Activity log</h1>
        <p className="muted">Everything that happened in your workspace, newest first. Entries are never edited.</p>
        <ul ref={list} aria-label="Activity" className="ruled-list">
          {entries.map((e) => {
            const title = e.workshopId ? titles.current.get(e.workshopId) : undefined;
            return (
              <li key={e.id} tabIndex={-1} className="ruled-row">
                <span className="mono">{instantDateTime(e.at, zone)}</span> — {e.label}
                {title ? ` — ${title}` : ""}
              </li>
            );
          })}
        </ul>
        {loaded && entries.length === 0 && <p className="empty">Nothing has happened yet.</p>}
        {cursor && (
          <button type="button" className="btn btn-quiet" onClick={() => void load(cursor)} disabled={busy}>
            Load more
          </button>
        )}
      </main>
    </AccountShell>
  );
}
