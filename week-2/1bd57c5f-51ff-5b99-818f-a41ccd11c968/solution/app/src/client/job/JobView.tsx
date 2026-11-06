import { Flag, Map as MapIcon, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { CATALOGUE } from "../../shared/catalogue";
import { JOB_STATUS_LABELS, isCrew, type Item, type Job, type User } from "../../shared/domain";
import { roundPin } from "../../shared/geometry";
import { mayEditFields } from "../../shared/lifecycle";
import { useAnnounce } from "../activity";
import { ApiFailure, api } from "../api";
import { Dialog, trapTab } from "../components/Dialog";
import { StageGlyph } from "../components/Glyphs";
import { COPY, readout } from "../copy";
import { useOnline } from "../online";
import { followLink, navigate } from "../router";
import { NotFound } from "../screens/NotFound";
import { AccessTab } from "./AccessTab";
import { CostsTab } from "./CostsTab";
import { JobContext, isMe, isTextField, type JobControls } from "./context";
import { OutboxTab } from "./OutboxTab";
import { PeopleTab } from "./PeopleTab";
import { EASE, PULSE_MS } from "../motion";
import { PlanView, type PlanHandle, type Placement } from "./PlanView";
import { PunchList } from "./PunchList";
import { JobSession } from "./session";
import { SetupTab } from "./SetupTab";
import { Tether, type TetherHandle } from "./Tether";

const REFRESH_MS = 15_000;
const SYNC_RETRY_MS = 5_000;

type Tab = "punch" | "setup" | "people" | "costs" | "access" | "outbox";
const TABS: Array<{ id: Tab; label: string; roles: readonly string[] }> = [
  { id: "punch", label: "Punch list", roles: ["owner", "lead", "trade", "homeowner"] },
  { id: "setup", label: "Setup", roles: ["owner"] },
  { id: "people", label: "People & visits", roles: ["owner", "lead"] },
  { id: "costs", label: "Costs", roles: ["owner", "lead"] },
  { id: "access", label: "Access", roles: ["owner", "lead"] },
  { id: "outbox", label: "Outbox", roles: ["owner"] },
];

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = matchMedia(query);
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    () => matchMedia(query).matches,
  );
}

function rowElement(itemId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(itemId)}"]`);
}

const onPlan = (value: number) => roundPin(Math.min(1, Math.max(0, value)));

/** The phone's plan bottom sheet: rises from the bottom, leaves the same way, keeps focus inside. */
function PlanSheet({ open, onClose, onClosed, reduced, children }: {
  open: boolean;
  onClose: () => void;
  onClosed: () => void;
  reduced: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [leaving, setLeaving] = useState(false);
  const swipe = useRef<number | null>(null);

  // Closing gives the page back at once: the modal state, the focus and every click. The sheet
  // then slides away as an inert, pointer-transparent layer and is gone when the slide ends.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const modal = dialog.matches(":modal");
    if (open && !modal) {
      if (dialog.open) dialog.close();
      setLeaving(false);
      dialog.showModal();
      dialog.querySelector<HTMLElement>(".sheet-close")?.focus();
    } else if (!open && modal) {
      dialog.close();
      if (!reduced) {
        dialog.show();
        setLeaving(true);
      }
      onClosed();
    }
  }, [open, reduced, onClosed]);

  return (
    <dialog
      ref={ref}
      className={leaving ? "sheet leaving" : "sheet"}
      aria-label="Plan"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (ref.current) trapTab(event, ref.current);
      }}
      inert={leaving}
      onAnimationEnd={(event) => {
        if (leaving && event.target === ref.current) {
          ref.current.close();
          setLeaving(false);
        }
      }}
    >
      <div className="sheet-inner">
        <div
          className="sheet-head"
          onPointerDown={(event) => {
            swipe.current = event.clientY;
          }}
          onPointerUp={(event) => {
            if (swipe.current !== null && event.clientY - swipe.current > 60) onClose();
            swipe.current = null;
          }}
        >
          <span className="sheet-handle" aria-hidden="true" />
          <span className="section-title">Plan</span>
        </div>
        <div className="sheet-body">{open || leaving ? children : null}</div>
        <div className="sheet-foot">
          <button type="button" className="btn btn--primary sheet-close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
            Close plan
          </button>
        </div>
      </div>
    </dialog>
  );
}

function CloseOut({ job, onClosed }: { job: Job; onClosed: (job: Job) => void }) {
  const announce = useAnnounce();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const closeOut = async () => {
    setPending(true);
    setError("");
    announce(COPY.saving);
    try {
      const closed = await api<Job>("POST", `/api/jobs/${job.id}/actions`, { action: "close_out" });
      setOpen(false);
      announce("Job closed out.");
      onClosed(closed);
    } catch (failure) {
      const message = failure instanceof ApiFailure ? failure.message : "Closing out needs a connection.";
      setError(message);
      announce(message);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <button type="button" className="btn btn--primary" disabled={!online} onClick={() => setOpen(true)}>
        <Flag size={16} aria-hidden="true" />
        Close out job
      </button>
      <Dialog open={open} title="Close out job" onClose={() => setOpen(false)}>
        <p>
          Close-out needs every item verified. It deletes the plan and photos from storage, and the job becomes read-only so the final
          payment can be released.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={pending} aria-busy={pending} onClick={() => void closeOut()}>
            Close out
          </button>
        </div>
      </Dialog>
    </>
  );
}

/**
 * Publishes the heights of the top bar, the connection banner and the job header as CSS
 * variables, so on wide screens the sticky plan pane sits exactly below them.
 */
function useStickyChrome(): (head: HTMLDivElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((head: HTMLDivElement | null) => {
    observer.current?.disconnect();
    const root = document.documentElement.style;
    if (!head) {
      for (const name of ["--bar-h", "--bars-h", "--chrome-h"]) root.removeProperty(name);
      return;
    }
    const bar = document.querySelector<HTMLElement>(".topbar");
    const connection = document.querySelector<HTMLElement>(".connection");
    const measure = () => {
      const barH = bar?.offsetHeight ?? 0;
      const barsH = barH + (connection?.offsetHeight ?? 0);
      root.setProperty("--bar-h", `${barH}px`);
      root.setProperty("--bars-h", `${barsH}px`);
      root.setProperty("--chrome-h", `${barsH + head.offsetHeight}px`);
    };
    measure();
    observer.current = new ResizeObserver(measure);
    for (const element of [bar, connection, head]) if (element) observer.current.observe(element);
  }, []);
}

export function JobView({ jobId, itemId, user }: { jobId: string; itemId: string | null; user: User }) {
  const announce = useAnnounce();
  const online = useOnline();
  const session = useMemo(() => new JobSession(jobId, user, announce), [jobId, user.email, announce]);
  useSyncExternalStore(session.subscribe, session.getVersion);
  const desktop = useMedia("(min-width: 1024px)");
  const tablet = useMedia("(min-width: 768px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const mode = desktop ? "desktop" : tablet ? "tablet" : "phone";

  const [deepLink] = useState(itemId);
  const [tab, setTab] = useState<Tab>(() => ((window.history.state as { tab?: Tab } | null)?.tab ?? "punch"));
  const [selectedId, setSelectedId] = useState<string | null>(itemId);
  const [selection, setSelection] = useState<{ id: string | null; count: number }>({ id: null, count: 0 });
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [dropping, setDropping] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const planRef = useRef<PlanHandle>(null);
  const tetherRef = useRef<TetherHandle>(null);
  const placementRef = useRef<Placement | null>(null);
  const placementOrigin = useRef<{ row: HTMLElement | null; openedSheet: boolean }>({ row: null, openedSheet: false });
  const sheetReturn = useRef<HTMLElement | null>(null);
  placementRef.current = placement;
  const jobHeadRef = useStickyChrome();

  useEffect(() => {
    const close = session.open();
    const refresh = () => {
      if (document.visibilityState === "visible") void session.refresh();
    };
    const refreshTimer = window.setInterval(() => void session.refresh(), REFRESH_MS);
    const syncTimer = window.setInterval(() => void session.flush(), SYNC_RETRY_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      close();
      window.clearInterval(refreshTimer);
      window.clearInterval(syncTimer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [session]);

  useEffect(() => {
    setRailOpen(false);
    setSheetOpen(false);
    tetherRef.current?.clear();
  }, [mode]);

  const view = session.view();
  const job = session.snapshot?.job ?? null;
  const role = job?.my_role ?? "homeowner";
  const crew = isCrew(role);
  const readOnly = job?.status === "closed_out";
  const reviewCount = view.items.filter((item) => item.pin_status === "needs_review").length;

  const openSheet = useCallback((returnTo: HTMLElement | null) => {
    sheetReturn.current = returnTo ?? (document.activeElement as HTMLElement | null);
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setPlacement(null);
  }, []);

  const sheetClosed = useCallback(() => sheetReturn.current?.focus(), []);

  const select = useCallback(
    (item: Item) => {
      setSelectedId(item.id);
      setSelection((previous) => ({ id: item.id, count: previous.count + 1 }));
      // On a phone the sheet rises in the same step as the selection, framed on the row's room.
      if (mode === "phone" && !sheetOpen) openSheet(rowElement(item.id));
      navigate(`/jobs/${jobId}/items/${session.serverId(item.id)}`, { replace: true });
    },
    [jobId, session, mode, sheetOpen, openSheet],
  );

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setSelection((previous) => ({ id: null, count: previous.count + 1 }));
    tetherRef.current?.clear();
    navigate(`/jobs/${jobId}`, { replace: true });
  }, [jobId]);

  // The plan answers a selection: frame the room, then draw the tether, then pulse the pin once.
  useEffect(() => {
    tetherRef.current?.clear();
    const item = selection.id ? session.view().items.find((candidate) => candidate.id === selection.id) : undefined;
    if (!item) return;
    if (mode === "phone" || (mode === "tablet" && !railOpen)) return;
    let cancelled = false;
    void (async () => {
      await planRef.current?.frame(item.room_id, !reduced);
      if (cancelled || reduced || !item.pin) return;
      const row = rowElement(item.id);
      const pin = planRef.current?.pinElement(item.id);
      const pane = planRef.current?.pane();
      if (!row || !pin || !pane) return;
      await tetherRef.current?.draw(item.number, row, pin, pane);
      if (!cancelled) pin.animate([{ scale: "1" }, { scale: "1.25" }, { scale: "1" }], { duration: PULSE_MS, easing: EASE });
    })();
    return () => {
      cancelled = true;
    };
  }, [selection.count]); // Only a new selection moves the plan; refreshes and resizes do not.

  const canPlace = useCallback(
    (item: Item) => !readOnly && mayEditFields(role, isMe(item.created_by, user, role), ["pin"]),
    [readOnly, role, user],
  );

  const startPlacement = useCallback(
    (item: Item, row: HTMLElement | null) => {
      const room = session.view().rooms.find((candidate) => candidate.id === item.room_id);
      if (!room || !canPlace(item)) return;
      placementOrigin.current = { row, openedSheet: mode === "phone" && !sheetOpen };
      if (mode === "tablet") setRailOpen(true);
      if (mode === "phone" && !sheetOpen) openSheet(row);
      setPlacement({ itemId: item.id, number: item.number, x: onPlan(room.anchor.x), y: onPlan(room.anchor.y) });
    },
    [session, canPlace, mode, sheetOpen, openSheet],
  );

  const cancelPlacement = useCallback(() => {
    setPlacement(null);
    const { row, openedSheet } = placementOrigin.current;
    if (openedSheet) setSheetOpen(false);
    row?.focus();
  }, []);

  const dropPin = useCallback(async () => {
    const current = placementRef.current;
    const item = current && session.view().items.find((candidate) => candidate.id === current.itemId);
    if (!current || !item || dropping) return;
    setDropping(true);
    const refusal = await session.dropPin(item, { x: current.x, y: current.y });
    setDropping(false);
    if (refusal === null) setPlacement(null);
  }, [session, dropping]);

  useEffect(() => {
    if (!placement) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTextField(event.target)) return;
      const step = event.shiftKey ? 0.05 : 0.01;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = moves[event.key];
      if (move) {
        event.preventDefault();
        event.stopPropagation();
        setPlacement((current) => current && { ...current, x: onPlan(current.x + move[0]), y: onPlan(current.y + move[1]) });
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        void dropPin();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelPlacement();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [placement !== null, dropPin, cancelPlacement]);

  if (session.phase === "role_ended") {
    return (
      <div className="page">
        <div className="notice">
          <h1>Access ended</h1>
          <p>{CATALOGUE.role_ended.message}</p>
          <a href="/jobs" onClick={followLink}>
            {COPY.backToJobs}
          </a>
        </div>
      </div>
    );
  }
  if (session.phase === "not_found") return <NotFound />;
  if (session.phase === "unavailable") {
    return (
      <div className="page">
        <div className="notice">
          <h1>Job not on this phone yet</h1>
          <p>This job has not been opened on this device before, so it needs a connection the first time.</p>
          <a href="/jobs" onClick={followLink}>
            {COPY.backToJobs}
          </a>
        </div>
      </div>
    );
  }
  if (!job) return <p className="loading">Loading</p>;
  if (deepLink && !view.items.some((item) => session.serverId(item.id) === deepLink || item.id === deepLink)) return <NotFound />;

  const selectedKey = selectedId && session.serverId(selectedId);
  const controls: JobControls = {
    session,
    job,
    user,
    role,
    online,
    readOnly,
    reduced,
    selectedId: selectedKey,
    select,
    clearSelection,
    startPlacement,
    canPlace,
  };

  const tabs = TABS.filter((candidate) => candidate.roles.includes(role));
  const activeTab = tabs.some((candidate) => candidate.id === tab) ? tab : "punch";

  const placementBar = placement ? (
    <div className="placement-bar">
      <div role="status" aria-label="Pin placement" className="placement-readout">
        {readout(placement.number, placement.x, placement.y)}
      </div>
      <div className="placement-buttons">
        <button type="button" className="btn btn--primary btn--small" disabled={dropping} aria-busy={dropping} onClick={() => void dropPin()}>
          Drop pin
        </button>
        <button type="button" className="btn btn--small" onClick={cancelPlacement}>
          Cancel placement
        </button>
      </div>
    </div>
  ) : null;

  const plan = (
    <PlanView
      ref={planRef}
      job={job}
      planKey={session.planVersion}
      rooms={view.rooms}
      items={view.items}
      initialRoomId={mode === "phone" ? (view.items.find((item) => item.id === selectedKey)?.room_id ?? null) : null}
      ringedId={reduced ? selectedKey : null}
      placement={placement}
      onPin={(item) => {
        flushSync(() => select(item));
        rowElement(item.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }}
      onPoint={(x, y) => setPlacement((current) => current && { ...current, x, y })}
      onDropItem={(dropped, x, y) => {
        const item = session.view().items.find((candidate) => candidate.id === dropped);
        if (item && canPlace(item)) void session.dropPin(item, { x, y });
      }}
      placementBar={placementBar}
    />
  );

  const stageAction = async (action: "start_walkthrough") => {
    announce(COPY.saving);
    try {
      session.setSnapshot({ job: await api<Job>("POST", `/api/jobs/${job.id}/actions`, { action }) });
      announce("Walkthrough started.");
    } catch (failure) {
      announce(failure instanceof ApiFailure ? failure.message : "Starting the walkthrough needs a connection.");
    }
  };

  return (
    <JobContext.Provider value={controls}>
      <div className="job-head" ref={jobHeadRef}>
        <h1>{job.name}</h1>
        <dl className="title-block">
          <div className="title-cell">
            <dt>Stage</dt>
            <dd className={`stage stage--${job.status}`}>
              <StageGlyph status={job.status} />
              {JOB_STATUS_LABELS[job.status]}
            </dd>
          </div>
          <div className="title-cell">
            <dt>Progress</dt>
            <dd className="progress mono">{view.progress.percent}% verified</dd>
          </div>
          {crew && reviewCount > 0 && (
            <div className="title-cell">
              <dt>Review</dt>
              <dd className="review-count mono">{reviewCount} pins need review</dd>
            </div>
          )}
          <div className="title-cell title-cell--wide">
            <dt>Address</dt>
            <dd>{job.address}</dd>
          </div>
        </dl>
        {role === "owner" && job.status !== "closed_out" && (
            <div className="stage-actions">
              {job.status === "active" && (
                <button type="button" className="btn btn--primary" disabled={!online} onClick={() => void stageAction("start_walkthrough")}>
                  Start walkthrough
                </button>
              )}
              {job.status === "walkthrough" && (
                <CloseOut
                  job={job}
                  onClosed={(closed) => {
                    session.setSnapshot({ job: closed });
                    void session.refresh();
                  }}
                />
              )}
            </div>
          )}
        <div role="tablist" aria-label="Job sections" className="tabs">
          {tabs.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              id={`tab-${candidate.id}`}
              aria-selected={candidate.id === activeTab}
              aria-controls={`panel-${candidate.id}`}
              tabIndex={candidate.id === activeTab ? 0 : -1}
              onClick={() => setTab(candidate.id)}
              onKeyDown={(event) => {
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = tabs[(index + step + tabs.length) % tabs.length]!;
                setTab(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
              }}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        className={activeTab === "punch" ? "tab-panel tab-panel--punch" : "tab-panel"}
      >
        {activeTab === "punch" && (
          <>
            <PunchList />
            {mode === "desktop" && <div className="plan-pane">{plan}</div>}
            {mode === "tablet" && (
              <>
                <div className="plan-rail">
                  <button
                    type="button"
                    className="rail-toggle"
                    aria-label="Show plan"
                    aria-expanded={railOpen}
                    aria-controls="plan-rail-panel"
                    onClick={() => setRailOpen((open) => !open)}
                  >
                    <MapIcon size={20} aria-hidden="true" />
                    <span className="rail-toggle-text">Show plan</span>
                  </button>
                </div>
                <div id="plan-rail-panel" className="rail-panel" data-open={railOpen}>
                  {plan}
                </div>
              </>
            )}
            {mode === "phone" && (
              <>
                <div className="phone-bar">
                  <button type="button" className="btn btn--primary" aria-haspopup="dialog" onClick={(event) => openSheet(event.currentTarget)}>
                    <MapIcon size={18} aria-hidden="true" />
                    Show plan
                  </button>
                </div>
                <PlanSheet open={sheetOpen} onClose={closeSheet} onClosed={sheetClosed} reduced={reduced}>
                  {plan}
                </PlanSheet>
              </>
            )}
          </>
        )}
        {activeTab === "setup" && <SetupTab />}
        {activeTab === "people" && <PeopleTab />}
        {activeTab === "costs" && <CostsTab />}
        {activeTab === "access" && <AccessTab />}
        {activeTab === "outbox" && <OutboxTab />}
      </div>
      <Tether ref={tetherRef} />
    </JobContext.Provider>
  );
}
