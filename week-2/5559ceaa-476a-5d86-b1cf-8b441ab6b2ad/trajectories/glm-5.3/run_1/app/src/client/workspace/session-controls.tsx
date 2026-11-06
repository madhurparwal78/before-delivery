import { useState } from "react";
import { api } from "../lib/api";
import type { Session } from "../../shared/types";
import type { WorkspaceProject } from "./state";
import { MembersDialog } from "../components/members-dialog";
import { ScheduleDialog } from "../components/members-dialog";

export function SessionControls({
  project,
  session,
  setSession,
  isMentor,
  accountSlot,
}: {
  project: WorkspaceProject | null;
  session: Session | null;
  setSession: (s: Session | null) => void;
  isMentor: boolean;
  accountSlot: React.ReactNode;
}): React.ReactElement {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const current = session;
  const state = current?.state ?? "none";

  const call = async (action: string) => {
    if (!current || pending) return;
    setPending(true);
    setStatus("Updating session…");
    try {
      const res = await api<{ session: Session }>("POST", `/api/sessions/${current.id}/${action}`);
      if (res.data) setSession(res.data.session);
      if (res.data?.session.state === "ended") setSession(null);
      setStatus("");
    } catch (err) {
      const e = err as { code?: string; extra?: Record<string, unknown> };
      if (e.code === "illegal_transition") {
        setStatus(`That change isn't possible while the session is ${String(e.extra?.["from"] ?? "this state").toLowerCase()}.`);
      } else if (e.code === "session_already_live") {
        setStatus("Another session in this project is already running.");
      } else {
        setStatus("Something went wrong. Try again.");
      }
    } finally {
      setPending(false);
    }
  };

  const showStart = isMentor && (state === "scheduled" || state === "none");
  const showPause = isMentor && state === "live";
  const showResume = isMentor && state === "paused";
  const showEnd = isMentor && (state === "live" || state === "paused");

  return (
    <div className="session-controls">
      <span className="session-state mono" role="status" aria-label="Session status">
        {state === "none" ? "" : state.charAt(0).toUpperCase() + state.slice(1)}
        {status ? ` ${status}` : ""}
      </span>
      {isMentor ? (
        <>
          {showStart ? (
            current ? (
              <button onClick={() => void call("start")} disabled={pending}>
                Start session
              </button>
            ) : (
              <button onClick={() => setScheduleOpen(true)}>Schedule session</button>
            )
          ) : null}
          {showPause ? (
            <button onClick={() => void call("pause")} disabled={pending}>
              Pause session
            </button>
          ) : null}
          {showResume ? (
            <button onClick={() => void call("resume")} disabled={pending}>
              Resume session
            </button>
          ) : null}
          {showEnd ? (
            <button onClick={() => void call("end")} disabled={pending}>
              End session
            </button>
          ) : null}
        </>
      ) : null}
      <button onClick={() => setMembersOpen(true)}>Members</button>
      {accountSlot}
      {membersOpen && project ? (
        <MembersDialog
          project={project}
          onClose={() => setMembersOpen(false)}
        />
      ) : null}
      {scheduleOpen && project ? (
        <ScheduleDialog
          project={project}
          onClose={() => setScheduleOpen(false)}
          onScheduled={(s) => {
            setScheduleOpen(false);
            setSession(s);
          }}
        />
      ) : null}
    </div>
  );
}
