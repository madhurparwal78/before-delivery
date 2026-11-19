import { useEffect, useState, type FormEvent } from "react";
import { api, ApiFailure, failureText, tooManyAttempts } from "../api.js";
import { wallClock } from "../format.js";
import { navigate, useTitle } from "../ui.js";

const JOIN_MESSAGES: Record<string, string> = {
  not_found: "We couldn't find that workshop link.",
  link_revoked: "This join link has been turned off. Ask your facilitator for a new one.",
  link_expired: "This join link has expired. Ask your facilitator for a new one.",
  workshop_not_open: "This workshop hasn't opened yet. Try again when your facilitator opens the room.",
  workshop_closed: "This workshop has ended.",
  room_full: "This room is full. Ask your facilitator to free a place.",
};

function joinMessage(e: unknown): string {
  if (e instanceof ApiFailure && e.code === "rate_limited") return tooManyAttempts(e);
  return (e instanceof ApiFailure && JOIN_MESSAGES[e.code]) || failureText(e, "You're offline — check your connection and try again.");
}

interface JoinInfo {
  title: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  timeZone: string;
}

export function Join({ token }: { token: string }) {
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useTitle(info?.title ?? "Join a workshop");

  useEffect(() => {
    api<{ workshop: JoinInfo }>("GET", `/api/join/${encodeURIComponent(token)}`).then(
      (r) => setInfo(r.workshop),
      (e: unknown) => setBlocked(joinMessage(e)),
    );
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ workshopId: string }>("POST", `/api/join/${encodeURIComponent(token)}`, { displayName: name });
      navigate(`/w/${r.workshopId}`);
    } catch (failure) {
      setBusy(false);
      setError(joinMessage(failure));
    }
  };

  return (
    <div className="page page-narrow">
      <header className="site-header">
        <span className="wordmark">Lanternfold Rooms</span>
      </header>
      <main className="signin">
        {blocked ? (
          <>
            <h1 className="display-sm">Join a workshop</h1>
            <p className="join-blocked">{blocked}</p>
          </>
        ) : info ? (
          <>
            <p className="eyebrow">You're invited to</p>
            <h1 className="display-sm">{info.title}</h1>
            <p className="muted">
              {wallClock(info.scheduledStart)} to {wallClock(info.scheduledEnd)} ({info.timeZone})
            </p>
            <form onSubmit={submit} noValidate className="form">
              <div className="field">
                <label htmlFor="join-name">Your name</label>
                <input id="join-name" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
                <p className="field-hint">Shown to your facilitator only. No account needed.</p>
              </div>
              <div role="alert" className="form-alert">
                {error}
              </div>
              <button type="submit" className="btn btn-primary btn-block">
                {busy ? "Joining…" : "Join workshop"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="display-sm">Join a workshop</h1>
            <p className="muted">Opening the invitation…</p>
          </>
        )}
      </main>
    </div>
  );
}
