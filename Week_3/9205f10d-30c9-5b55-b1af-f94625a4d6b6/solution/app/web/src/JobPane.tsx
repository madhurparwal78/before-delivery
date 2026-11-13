import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api";
import { Braid } from "./Braid";
import { ClaimControls, Facts, HistoryList, SeatsList, markTaken } from "./JobDetail";
import { DURATION, REFRESH_MS, play, useInterval } from "./motion";
import { StaffingControls } from "./StaffingControls";
import { StatusMark } from "./StatusMark";
import type { ApiRequest, SeatLabel, User } from "./types";

interface PaneState {
  id: string;
  leaving: boolean;
}

/**
 * Which pane is on screen: it follows the URL's job id, but stays while sliding out after the
 * id is cleared, until the exit motion finishes.
 */
export function usePane(jobId: string | null): [PaneState | null, () => void] {
  const [pane, setPane] = useState<PaneState | null>(jobId ? { id: jobId, leaving: false } : null);
  useEffect(() => {
    setPane((current) => (jobId ? { id: jobId, leaving: false } : current ? { ...current, leaving: true } : null));
  }, [jobId]);
  const exited = useCallback(() => setPane((current) => (current?.leaving ? null : current)), []);
  return [pane, exited];
}

/** The pane slides in from the right edge while it fades in; controls settle within a few pixels at once. */
const SLIDE: Keyframe[] = [
  { transform: "translateX(64px)", opacity: 0 },
  { transform: "translateX(0)", opacity: 1 },
];

export function JobPane({
  pane,
  viewer,
  initial,
  openedByUser,
  onClose,
  onExited,
  onMissing,
}: {
  pane: PaneState;
  viewer: User;
  initial: ApiRequest | undefined;
  /** Opened by the viewer's own click or key: it slides in and takes focus. */
  openedByUser: boolean;
  onClose: () => void;
  onExited: () => void;
  onMissing: () => void;
}) {
  const [request, setRequest] = useState<ApiRequest | undefined>(initial);
  const [taken, setTaken] = useState<SeatLabel[]>([]);
  const shell = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const known = useRef(initial !== undefined);
  const missing = useRef(onMissing);
  missing.current = onMissing;
  const id = pane.id;

  const load = useCallback(async () => {
    const result = await api<ApiRequest>("GET", `/api/requests/${id}`);
    if (result.ok) {
      known.current = true;
      setRequest(result.data);
    } else if (result.status === 404 && !known.current) {
      missing.current();
    }
    // Once shown, a request the viewer can no longer read keeps its last view until they leave.
  }, [id]);

  useEffect(() => {
    setTaken([]);
    void load();
  }, [load]);
  useInterval(() => void load(), REFRESH_MS);

  // Opened from a row or a list, the pane slides in; loaded with the page itself it is simply
  // there, since nothing on screen changed.
  useLayoutEffect(() => {
    if (openedByUser) play(shell.current, SLIDE, DURATION.pane);
  }, [openedByUser]);

  useLayoutEffect(() => {
    if (!pane.leaving) return;
    const exit = play(shell.current, [...SLIDE].reverse(), DURATION.pane);
    if (exit) exit.onfinish = onExited;
    else onExited();
  }, [pane.leaving, onExited]);

  const ready = request !== undefined;
  useEffect(() => {
    if (ready && openedByUser) heading.current?.focus();
  }, [ready, openedByUser, id]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const shown = request ? markTaken(request, taken) : undefined;

  return (
    <section ref={shell} className="pane" aria-label="Job detail">
      <div className="pane-bar">
        <button type="button" className="button button--quiet pane-close" aria-label="Close job detail" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
          Close
        </button>
      </div>
      {shown ? (
        <div className="pane-body">
          <header className="pane-head">
            <h2 ref={heading} tabIndex={-1}>
              {shown.reference}
            </h2>
            <StatusMark request={shown} />
          </header>
          <Facts request={shown} />
          <section className="pane-section" aria-labelledby="seats-heading">
            <h3 id="seats-heading">Seats</h3>
            <SeatsList request={shown} />
          </section>
          <section className="pane-section" aria-labelledby="rotation-heading">
            <h3 id="rotation-heading">Rotation</h3>
            <Braid request={shown} />
          </section>
          {viewer.role === "coordinator" && (
            <>
              <StaffingControls key={shown.id} request={shown} onUpdated={setRequest} refresh={() => void load()} />
              <HistoryList request={shown} />
            </>
          )}
          {viewer.role === "interpreter" && (
            <ClaimControls
              key={shown.id}
              request={shown}
              onClaimed={setRequest}
              onTaken={(label) => setTaken((labels) => [...labels, label])}
              refresh={() => void load()}
            />
          )}
        </div>
      ) : (
        <p className="pane-body quiet">Loading job…</p>
      )}
    </section>
  );
}
