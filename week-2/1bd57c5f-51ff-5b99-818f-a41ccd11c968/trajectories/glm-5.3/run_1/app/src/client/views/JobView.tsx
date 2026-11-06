/** The job view: header, tabs, the punch list, the plan pane, dialogs and the
 *  offline queue. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api, hasQueuedChanges, queueFor, readCachedJob, TRADE_LABELS,
  type AccessCard, type ApiErrorBody, type Costs, type Item, type Job, type JobData,
  type Member, type Note, type OutboxEntry, type Photo, type PlanRevision, type Room,
  type TradeKey, type User, type Visit,
} from "../api.js";
import { Dialog, BottomSheet, money, prefersReducedMotion, useOnlineStatus } from "../components.js";
import {
  loadJob, openStream, pendingByItem, queueAction, queueItem, queueNote, queueNoteEdit, queueUpdate, runSync,
  type LiveEvent,
} from "../store.js";
import { JobTabs, HouseAccessRegion } from "./JobTabs.js";
import { ItemDetails } from "./ItemDetails.js";
import { PlanArea, type PlanRect, type PlacementState } from "./PlanPane.js";

const STATUS_LABELS: Record<Item["status"], string> = {
  open: "Open", in_progress: "In progress", ready_for_check: "Ready for check", verified: "Verified",
};



export type RowRef = { id: string; el: HTMLElement | null };

export function tradeLabel(trade: TradeKey | null): string {
  return trade === null ? "Crew" : TRADE_LABELS[trade];
}

export function errorMessage(err: unknown): string {
  const body = (err as { body?: ApiErrorBody; message?: string }).body;
  return body?.message ?? (err as { message?: string }).message ?? "Something went wrong.";
}

export function fieldMessage(err: unknown, field: string): string | null {
  const body = (err as { body?: ApiErrorBody }).body;
  const fields = body?.fields;
  if (fields === undefined) return null;
  return fields[field] ?? null;
}

export function JobView({ jobId, initialItemId, user, onUnauthenticated, onNotFound }: {
  jobId: string;
  initialItemId: string | undefined;
  user: User | null;
  onUnauthenticated: () => void;
  onNotFound: () => void;
}): JSX.Element {
  const [data, setData] = useState<JobData | null>(() => readCachedJob<JobData>(jobId));
  const [failed, setFailed] = useState<"notfound" | "roleended" | null>(null);
  const [roleEndedMessage, setRoleEndedMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialItemId ?? null);
  const [activity, setActivity] = useState("");
  const [tab, setTab] = useState("Punch list");
  const [online, setOnline] = useState(navigator.onLine);
  const [planOpen, setPlanOpen] = useState(false);
  const [placement, setPlacement] = useState<PlacementState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [alert, setAlert] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<{ title: string; body: React.ReactNode } | null>(null);
  const [planRect, setPlanRect] = useState<PlanRect | null>(null);
  const [showRoom, setShowRoom] = useState("all");
  const [showStatus, setShowStatus] = useState("all");
  const [showTrade, setShowTrade] = useState("all");
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAddRoom, setQuickAddRoom] = useState<string>("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const refreshTimer = useRef<number | null>(null);

  const crew = data !== null && (data.job.my_role === "owner" || data.job.my_role === "lead");
  const role = data?.job.my_role ?? "homeowner";

  const announce = useCallback((message: string) => {
    setActivity(message);
  }, []);

  // Load the job data.
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const fresh = await loadJob(jobId);
      setData(fresh);
      setFailed(null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const body = (err as { body?: ApiErrorBody; status?: number }).body;
      if (status === 0) return; // offline: the cached view keeps working
      if (body?.error === "role_ended") {
        setFailed("roleended");
        setRoleEndedMessage(body.message);
      } else if (body?.error === "unauthenticated") {
        onUnauthenticated();
      } else {
        setFailed("notfound");
      }
    }
  }, [jobId, onUnauthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The quick-add room picker starts on the first room.
  useEffect(() => {
    setData((prev) => {
      if (prev === null) return prev;
      return prev;
    });
    setQuickAddRoom((prev) => {
      if (prev !== "") return prev;
      const cached = readCachedJob<JobData>(jobId);
      return cached?.rooms[0]?.id ?? "";
    });
  }, [jobId, data]);

  // The live event stream, projected per frame.
  const openTheStream = useCallback((): void => {
    streamRef.current?.close();
    const apply = (event: LiveEvent): void => {
      setData((prev) => {
        if (prev === null) return prev;
        switch (event.type) {
          case "item": {
            const items = prev.items.filter((i) => i.id !== event.item.id);
            const withoutClientRows = items.filter((i) => !i.id.startsWith("client:"));
            return { ...prev, items: [...withoutClientRows, event.item].sort((a, b) => a.number - b.number) };
          }
          case "item_deleted":
            return { ...prev, items: prev.items.filter((i) => i.id !== event.id) };
          case "room":
            return { ...prev, rooms: prev.rooms.map((r) => (r.id === event.room.id ? event.room : r)) };
          case "counts": {
            const rooms = prev.rooms.map((r) => {
              const found = event.rooms.find((x) => x.id === r.id);
              return found === undefined ? r : { ...r, counts: found.counts };
            });
            return { ...prev, job: { ...prev.job, progress: event.progress }, rooms };
          }
          case "plan":
            return { ...prev, job: { ...prev.job, plan_revision: event.revision, plan_url: event.plan_url } };
          case "visit": {
            const others = prev.visits.filter((v) => v.id !== event.visit.id);
            return { ...prev, visits: [...others, event.visit] };
          }
          case "visit_deleted":
            return { ...prev, visits: prev.visits.filter((v) => v.id !== event.id) };
          case "costs":
            return { ...prev, costs: event.costs };
          case "job":
            return { ...prev, job: event.job };
          default:
            return prev;
        }
      });
    };
    streamRef.current = openStream(
      jobId,
      apply,
      () => {
        setFailed("roleended");
        setRoleEndedMessage("Your access to this job has ended.");
      },
      onUnauthenticated,
    );
  }, [jobId, onUnauthenticated]);

  useEffect(() => {
    openTheStream();
    return () => streamRef.current?.close();
  }, [openTheStream]);

  // The 15-second fallback refresh and the focus refresh.
  useEffect(() => {
    refreshTimer.current = window.setInterval(() => {
      void refresh();
    }, 15000);
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      if (refreshTimer.current !== null) window.clearInterval(refreshTimer.current);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Online status and the offline sync.
  useEffect(() => {
    const goOnline = (): void => {
      setOnline(true);
      openTheStream();
      void syncNow();
    };
    const goOffline = (): void => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (navigator.onLine && hasQueuedChanges(jobId)) void syncNow();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, openTheStream]);

  const syncNow = async (): Promise<void> => {
    const result = await runSync(jobId);
    if (result.sentence !== "") announce(result.sentence);
    await refresh();
  };

  // Pending operations mark rows and change them optimistically.
  // The queue lives in localStorage; reading it per render keeps the pending
  // marks and the optimistic overlay in step with every enqueue.
  const pending = pendingByItem(jobId);

  // The rows: server items plus queued offline creations.
  const items = useMemo(() => {
    if (data === null) return [];
    const rows = [...data.items];
    for (const [key, ops] of pending) {
      if (!key.startsWith("client:")) continue;
      const create = ops.find((op) => op.type === "create_item");
      if (create === undefined || create.type !== "create_item") continue;
      rows.push({
        id: key,
        number: -1,
        title: String(create.fields.title ?? ""),
        room_id: String(create.fields.room_id ?? ""),
        trade: (create.fields.trade as TradeKey | null) ?? null,
        status: "open",
        pin: (create.fields.pin as Item["pin"]) ?? null,
        pin_status: create.fields.pin === undefined ? "unpinned" : "placed",
        blocked_by: [],
        photos: [],
        notes: [],
        created_by: { name: user?.name ?? "", role: role as Item["created_by"]["role"] },
        updated_at: new Date().toISOString(),
      });
    }
    return rows.sort((a, b) => (a.number === -1 ? 1 : b.number === -1 ? -1 : a.number - b.number));
  }, [data, pending, user, role]);

  const overlayItem = useCallback((item: Item): Item => {
    const ops = pending.get(item.id);
    if (ops === undefined) return item;
    let out = item;
    for (const op of ops) {
      if (op.type === "update_item") {
        for (const [field, change] of Object.entries(op.changes)) {
          out = { ...out, [field]: change.to } as Item;
        }
      } else if (op.type === "item_action") {
        if (op.action === "start") out = { ...out, status: "in_progress" };
        if (op.action === "mark_done") out = { ...out, status: "ready_for_check" };
        if (op.action === "verify") out = { ...out, status: "verified" };
        if (op.action === "reopen") out = { ...out, status: "open" };
      }
    }
    return out;
  }, [pending]);

  if (failed === "notfound") {
    return (
      <main className="not-found" aria-label="Not found">
        <h1>We can't find that page.</h1>
        <p><a href="/jobs">Back to your jobs</a></p>
      </main>
    );
  }
  if (failed === "roleended") {
    return (
      <main className="role-ended" aria-label="Role ended">
        <p>{roleEndedMessage}</p>
        <p><a href="/jobs">Back to your jobs</a></p>
      </main>
    );
  }
  if (data === null) return <p style={{ padding: 20 }}>Loading…</p>;

  const job = data.job;
  const rooms = data.rooms;
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const reviewCount = items.filter((i) => overlayItem(i).pin_status === "needs_review").length;
  const conflicts = crew ? items.flatMap((i) => (overlayItem(i).conflicts ?? []).map((c) => ({ item: overlayItem(i), conflict: c }))) : [];

  // --- Filters ---

  const rowPasses = (item: Item): boolean => {
    if (showRoom !== "all" && item.room_id !== showRoom) return false;
    if (showStatus !== "all" && item.status !== showStatus) return false;
    if (showTrade === "crew" && item.trade !== null) return false;
    if (showTrade !== "all" && showTrade !== "crew" && item.trade !== showTrade) return false;
    return true;
  };
  const shownRows = items.filter(rowPasses);

  // --- Actions ---

  const wrap = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      announce(`Not saved: ${errorMessage(err)}`);
    }
  };

  const quickAdd = async (): Promise<void> => {
    if (quickAddTitle.trim() === "") return;
    const title = quickAddTitle.trim();
    const roomId = quickAddRoom || rooms[0]?.id || "";
    setQuickAddTitle("");
    if (!online) {
      queueItem(jobId, { title, room_id: roomId });
      announce("Waiting to sync");
      return;
    }
    try {
      const created = await api<Item>("POST", `/api/jobs/${jobId}/items`, { title, room_id: roomId });
      announce(`Item ${created.number} saved.`);
      setSelectedId(created.id);
    } catch (err) {
      announce(`Not saved: ${errorMessage(err)}`);
    }
  };

  const act = async (item: Item, action: string, reason?: string): Promise<void> => {
    if (!online) {
      queueAction(jobId, item.id, action, reason);
      announce("Waiting to sync");
      return;
    }
    try {
      const updated = await api<Item & { reopened_dependents?: number[] }>(
        "POST", `/api/jobs/${jobId}/items/${item.id}/actions`, { action, reason },
      );
      announce(`Item ${item.number}: ${STATUS_LABELS[updated.status]}.`);
    } catch (err) {
      announce(`Not saved: ${errorMessage(err)}`);
    }
  };

  const patchItem = async (item: Item, changes: Record<string, unknown>): Promise<void> => {
    if (!online) {
      const queueChanges: Record<string, { from: unknown; to: unknown }> = {};
      for (const [field, to] of Object.entries(changes)) {
        queueChanges[field] = { from: field === "pin" ? item.pin : (item as unknown as Record<string, unknown>)[field] ?? null, to };
      }
      queueUpdate(jobId, item.id, queueChanges);
      announce("Waiting to sync");
      return;
    }
    try {
      const updated = await api<Item>("PATCH", `/api/jobs/${jobId}/items/${item.id}`, changes);
      announce(`Item ${item.number} saved.`);
      void updated;
    } catch (err) {
      announce(`Not saved: ${errorMessage(err)}`);
    }
  };

  const bulk = async (action: "verify" | "set_trade", trade?: string): Promise<void> => {
    if (shownRows.length === 0) return;
    const ids = shownRows.filter((r) => !r.id.startsWith("client:")).map((r) => r.id);
    try {
      if (action === "verify") {
        await api("POST", `/api/jobs/${jobId}/items/bulk`, { action: "verify", item_ids: ids });
        announce(`${ids.length} items checked off.`);
      } else {
        await api("POST", `/api/jobs/${jobId}/items/bulk`, { action: "set_trade", trade: trade ?? null, item_ids: ids });
        announce(`${ids.length} items assigned to ${trade === undefined ? "No trade" : tradeLabel(trade as TradeKey)}.`);
      }
      setAlert(null);
    } catch (err) {
      const body = (err as { body?: { failures?: { number: number; message: string }[] } }).body;
      const failures = body?.failures ?? [];
      setAlert(failures.map((f) => `Item ${f.number}: ${f.message}`));
      announce(`Not saved: None of the items changed.`);
    }
  };

  // --- Keyboard pin placement ---

  const startPlacement = (item: Item): void => {
    const room = roomById.get(item.room_id);
    const anchor = room?.anchor ?? { x: 0.5, y: 0.5 };
    setPlacement({ itemId: item.id, x: anchor.x, y: anchor.y } as PlacementState);
    if (window.innerWidth < 768) {
      setSheetOpen(true);
    } else if (window.innerWidth < 1024) {
      setPlanOpen(true);
    }
    void refresh();
  };

  const movePlacement = (dx: number, dy: number): void => {
    setPlacement((prev) => {
      if (prev === null) return prev;
      return {
        itemId: prev.itemId,
        x: Math.min(1, Math.max(0, Math.round((prev.x + dx) * 100) / 100)),
        y: Math.min(1, Math.max(0, Math.round((prev.y + dy) * 100) / 100)),
      };
    });
  };

  const setPlacementPoint = (x: number, y: number): void => {
    setPlacement((prev) => {
      if (prev === null) return prev;
      return { itemId: prev.itemId, x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
    });
  };

  const dropPin = async (): Promise<void> => {
    if (placement === null) return;
    const item = items.find((i) => i.id === placement.itemId);
    if (item === undefined) return;
    const pin = { x: Math.round(placement.x * 10000) / 10000, y: Math.round(placement.y * 10000) / 10000 };
    if (!online) {
      queueUpdate(jobId, item.id, { pin: { from: item.pin, to: pin } });
      announce("Waiting to sync");
      setPlacement(null);
      return;
    }
    try {
      const updated = await api<Item>("PATCH", `/api/jobs/${jobId}/items/${item.id}`, { pin });
      const roomName = roomById.get(updated.room_id)?.name ?? "";
      announce(`Pin dropped for item ${updated.number} in ${roomName}.`);
      setPlacement(null);
    } catch (err) {
      const message = fieldMessage(err, "pin") ?? errorMessage(err);
      announce(`Not saved: ${message}`);
    }
  };

  // --- Selection tether ---

  const selected = selectedId === null ? null : items.find((i) => i.id === selectedId) ?? null;
  const reduced = prefersReducedMotion();

  const stageButtons = (): JSX.Element | null => {
    if (role !== "owner") return null;
    if (job.status === "active") {
      return (
        <button type="button" onClick={() => {
          void wrap(async () => {
            await api("POST", `/api/jobs/${jobId}/actions`, { action: "start_walkthrough" });
            announce("Walkthrough started.");
          });
        }}>Start walkthrough</button>
      );
    }
    if (job.status === "walkthrough") {
      return (
        <button type="button" onClick={() => setDialog({ title: "Close out job", body: <CloseOutBody onConfirm={() => {
          void wrap(async () => {
            await api("POST", `/api/jobs/${jobId}/actions`, { action: "close_out" });
            announce("Job closed out.");
            setDialog(null);
          });
        }} /> })}>Close out job</button>
      );
    }
    return null;
  };

  return (
    <div aria-label={job.name}>
      <header className="job-header">
        <h1>{job.name}</h1>
        <span className="stage-label">{job.status === "active" ? "Active" : job.status === "walkthrough" ? "Walkthrough" : "Closed out"}</span>
        <span className="mono">{job.progress.percent}% verified</span>
        {crew && reviewCount > 0 && <span className="mono">{reviewCount} pins need review</span>}
        <span className="spacer" />
        {stageButtons()}
      </header>
      <div className="tablist" role="tablist">
        {["Punch list", ...(role === "owner" ? ["Setup"] : []), ...(crew ? ["People & visits"] : []), ...(crew ? ["Costs"] : []), ...(crew ? ["Access"] : []), ...(role === "owner" ? ["Outbox"] : [])].map((name) => (
          <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>
        ))}
      </div>

      {tab !== "Punch list" ? (
        <JobTabs
          tab={tab} data={data} setData={setData as unknown as (fn: (prev: JobData) => JobData) => void} online={online} announce={announce} refresh={refresh}
        />
      ) : (
        <div className="job-body">
          <div className="list-pane" ref={listRef}>
            <div className="list-controls">
              {role === "trade" && (
                <HouseAccessRegion jobId={jobId} announce={announce} online={online} nextVisit={job.next_visit} />
              )}
              {role !== "trade" && (
                <div className="quick-add">
                  <label htmlFor="quick-add" className="sr-only" style={{ position: "absolute", left: -9999 }}>Quick add item</label>
                  <input
                    id="quick-add" type="text" placeholder="Quick add item" aria-label="Quick add item"
                    value={quickAddTitle}
                    onChange={(e) => setQuickAddTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void quickAdd(); } }}
                  />
                  <select
                    aria-label="Quick add room" value={quickAddRoom}
                    onChange={(e) => setQuickAddRoom(e.target.value)}
                  >
                    {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              )}
              <div className="filters">
                <select aria-label="Show room" value={showRoom} onChange={(e) => setShowRoom(e.target.value)}>
                  <option value="all">All rooms</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <select aria-label="Show status" value={showStatus} onChange={(e) => setShowStatus(e.target.value)}>
                  <option value="all">All</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="ready_for_check">Ready for check</option>
                  <option value="verified">Verified</option>
                </select>
                <select aria-label="Show trade" value={showTrade} onChange={(e) => setShowTrade(e.target.value)}>
                  <option value="all">All trades</option>
                  <option value="crew">Crew</option>
                  {(Object.keys(TRADE_LABELS) as TradeKey[]).map((t) => <option key={t} value={t}>{TRADE_LABELS[t]}</option>)}
                </select>
              </div>
              {crew && (
                <div className="bulk-controls">
                  <button type="button" disabled={!online || shownRows.length === 0} onClick={() => { void bulk("verify"); }}>
                    Check off {shownRows.length} shown
                  </button>
                  <select aria-label="Assign shown to" defaultValue="">
                    <option value="" disabled>Assign shown to</option>
                    <option value="crew">Crew</option>
                    {(Object.keys(TRADE_LABELS) as TradeKey[]).map((t) => <option key={t} value={t}>{TRADE_LABELS[t]}</option>)}
                  </select>
                  <button
                    type="button" disabled={!online || shownRows.length === 0}
                    onClick={(e) => {
                      const select = (e.currentTarget.previousElementSibling as HTMLSelectElement).value;
                      const trade = select === "crew" ? null : select;
                      void bulk("set_trade", trade === null ? undefined : (trade as string));
                    }}
                  >
                    Assign {shownRows.length} shown
                  </button>
                </div>
              )}
              {alert !== null && (
                <div className="error-summary" role="alert">
                  <h2 style={{ fontSize: "1rem" }}>Nothing changed</h2>
                  {alert.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              )}
            </div>

            {crew && conflicts.length > 0 && (
              <section className="conflict-region" aria-label="Needs a decision">
                <h2>Needs a decision</h2>
                {conflicts.map(({ item, conflict }) => (
                  <div className="conflict-group" key={`${item.id}-${conflict.field}`}>
                    <p>
                      Item {item.number === -1 ? "" : item.number}:{" "}
                      {conflict.field === "room_id" ? "Room" : conflict.field === "cost_note" ? "Cost note"
                        : conflict.field === "unit_cost" ? "Unit cost" : conflict.field.charAt(0).toUpperCase() + conflict.field.slice(1)}
                    </p>
                    <div className="conflict-values">
                      <button type="button" className="quiet" onClick={() => {
                        void wrap(async () => {
                          await api("POST", `/api/jobs/${jobId}/items/${item.id}/resolve`, { field: conflict.field, value: conflict.server_value });
                          announce("Conflict resolved.");
                        });
                      }}>
                        Keep {conflictValueText(conflict.server_value, conflict.field, roomById)}
                      </button>
                      <button type="button" className="quiet" onClick={() => {
                        void wrap(async () => {
                          await api("POST", `/api/jobs/${jobId}/items/${item.id}/resolve`, { field: conflict.field, value: conflict.phone_value });
                          announce("Conflict resolved.");
                        });
                      }}>
                        Keep {conflictValueText(conflict.phone_value, conflict.field, roomById)}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {rooms.map((room) => {
              const roomItems = items.filter((i) => i.room_id === room.id);
              const visible = roomItems.filter(rowPasses);
              const counts = roomCounts(roomItems);
              return (
                <section className="room-group" key={room.id} aria-label={`${room.name} items`}>
                  <div className="room-heading">
                    <h2>{room.name}</h2>
                    <span className="room-count">{counts.verified} of {counts.total} verified</span>
                  </div>
                  {roomItems.length === 0 ? (
                    <p className="empty-room">No items in this room yet.</p>
                  ) : (
                    <ul className="room-items" aria-label={`${room.name} items`}>
                      {visible.map((raw) => {
                        const item = overlayItem(raw);
                        const pendingOps = pending.get(item.id) ?? [];
                        const isPending = pendingOps.length > 0;
                        const label = `Item ${item.number === -1 ? "" : item.number}: ${item.title}`;
                        return (
                          <li key={item.id}>
                            <div
                              data-item={item.id}
                              className="item-row"
                              role="listitem"
                              tabIndex={0}
                              aria-current={selectedId === item.id ? "true" : undefined}
                              aria-label={label}
                              onClick={() => setSelectedId(item.id === selectedId ? null : item.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedId(item.id === selectedId ? null : item.id);
                                } else if (e.key === "Escape" && selectedId === item.id) {
                                  setSelectedId(null);
                                } else if (e.key === "p" || e.key === "P") {
                                  const inField = e.target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
                                  if (!inField) {
                                    e.preventDefault();
                                    startPlacement(item);
                                  }
                                }
                              }}
                            >
                              <span className="item-num">{item.number === -1 ? "…" : item.number}</span>
                              <span className="item-title">{item.title}</span>
                              <span className="item-trade">{tradeLabel(item.trade)}</span>
                              <span className={`item-status ${item.status}`}>{STATUS_LABELS[item.status]}</span>
                              {item.pin_status === "needs_review" && <span className="item-review">Pin needs review</span>}
                              {item.pin !== null && item.pin_status !== "needs_review" && <span className="item-review" aria-hidden="true">📍</span>}
                              {item.blocked_by.length > 0 && <span className="item-waiting">Waiting on {item.blocked_by.join(", ")}</span>}
                              {isPending && <span className="item-pending">Waiting to sync</span>}
                              <RowActions
                                item={item} role={role} online={online} crew={crew} act={act}
                              />
                            </div>
                            {selectedId === item.id && (
                              <ItemDetails
                                item={item} data={data} user={user} online={online}
                                patchItem={(changes) => patchItem(item, changes)}
                                startPlacement={() => startPlacement(item)}
                                announce={announce}
                                refresh={refresh}
                                onClose={() => setSelectedId(null)}
                                setDialog={setDialog}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
            <div className="activity-strip" role="status" aria-live="polite" aria-label="Activity">
              {activity}
            </div>
          </div>

          <PlanArea
            data={data}
            items={items}
            overlayItem={overlayItem}
            selectedId={selectedId}
            placement={placement}
            reduced={reduced}
            onPlanRect={setPlanRect}
            onPlacementMove={movePlacement}
            onPlacementSet={setPlacementPoint}
            onPlacementDrop={() => { void dropPin(); }}
            onPlacementCancel={() => setPlacement(null)}
            onPinSelect={(id) => {
              setSelectedId(id);
              const el = listRef.current?.querySelector(`[data-item="${id}"]`);
              el?.scrollIntoView({ block: "center" });
            }}
            railOpen={planOpen}
            onRailOpenChange={setPlanOpen}
            sheetOpen={sheetOpen}
            onSheetOpenChange={setSheetOpen}
          />
          {selected !== null && selected.pin !== null && !reduced && planRect !== null && (
            <TetherOverlay planRect={planRect} pin={selected.pin} />
          )}
        </div>
      )}
      {dialog !== null && (
        <Dialog title={dialog.title} onClose={() => setDialog(null)}>{dialog.body}</Dialog>
      )}
    </div>
  );
}

function roomCounts(items: Item[]): { verified: number; total: number } {
  return { verified: items.filter((i) => i.status === "verified").length, total: items.length };
}

export function conflictValueText(value: unknown, field: string, rooms: Map<string, Room>): string {
  if (value === null) {
    if (field === "pin") return "No pin";
    if (field === "quantity" || field === "unit_cost") return "No value";
    if (field === "trade") return "No trade";
    return "No value";
  }
  if (field === "room_id") return rooms.get(String(value))?.name ?? String(value);
  if (field === "trade") return tradeLabel(value as TradeKey);
  if (field === "pin") {
    const pin = value as { x: number; y: number };
    return `${Math.round(pin.x * 100)}%, ${Math.round(pin.y * 100)}%`;
  }
  return String(value);
}

function RowActions({ item, role, online, crew, act }: {
  item: Item; role: string; online: boolean; crew: boolean;
  act: (item: Item, action: string, reason?: string) => Promise<void>;
}): JSX.Element {
  const num = item.number === -1 ? "" : item.number;
  return (
    <span className="row-actions">
      {(crew || (role === "trade" && item.trade !== null)) && item.status === "open" && (
        <button type="button" onClick={(e) => { e.stopPropagation(); void act(item, "start"); }}>Start item {num}</button>
      )}
      {(crew || (role === "trade" && item.trade !== null)) && item.status === "in_progress" && (
        <button type="button" onClick={(e) => { e.stopPropagation(); void act(item, "mark_done"); }}>Mark item {num} done</button>
      )}
      {crew && (item.status === "open" || item.status === "in_progress" || item.status === "ready_for_check") && (
        <button type="button" onClick={(e) => { e.stopPropagation(); void act(item, "verify"); }}>Check off item {num}</button>
      )}
    </span>
  );
}

function CloseOutBody({ onConfirm }: { onConfirm: () => void }): JSX.Element {
  return (
    <div>
      <p>Close out this job? Every plan revision and photo will be deleted.</p>
      <div className="row">
        <button type="button" className="primary" onClick={onConfirm}>Close out</button>
      </div>
    </div>
  );
}

/** The signature room tether: a blueprint line from the selected row's trailing
 *  edge to its pin, drawn across the whole job body. */
function TetherOverlay({ planRect, pin }: { planRect: { left: number; top: number; width: number; height: number }; pin: { x: number; y: number } }): JSX.Element | null {
  const row = document.querySelector('.item-row[aria-current="true"]');
  const body = document.querySelector('.job-body');
  if (row === null || body === null) return null;
  const rowRect = row.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();
  const startX = rowRect.right - bodyRect.left;
  const startY = rowRect.top + Math.min(rowRect.height, 60) / 2 - bodyRect.top;
  const endX = planRect.left + pin.x * planRect.width;
  const endY = planRect.top + pin.y * planRect.height;
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 4) return null;
  const angle = Math.atan2(dy, dx);
  return (
    <span
      className="tether-line"
      data-tether="true"
      aria-hidden="true"
      style={{ left: startX, top: startY - 1, width: length, transform: `rotate(${angle}rad)` }}
    />
  );
}
