import { useEffect, useRef, useState, type FormEvent } from "react";
import { request } from "../api.ts";
import { RELEASE_NOT_CLEARED, RELEASE_RELEASED_NOW, RELEASE_TWO_PERSON, RELEASE_UNCONFIRMED, SESSION_ENDED_DIALOG, SIGN_IN_FAILED, UNEXPECTED } from "../copy.ts";
import { usePolling } from "../hooks.ts";
import { ModalFrame } from "./Modal.tsx";
import { randomKey } from "./session.ts";
import type { BoardResponse, ReleaseResponse, RestatementView, StaffUser } from "../../shared/domain.ts";
import { isoWallClock, isoWallDate } from "../../shared/newyork.ts";

export interface DialogSession {
  id: number;
  closing: boolean;
  isActive: () => boolean;
  cancel: () => void;
  gone: () => void;
}

function useFocusOnOpen<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

function releaseCopy(answer: Awaited<ReturnType<typeof request<ReleaseResponse>>>): { copy: string; http: boolean } {
  if (answer.kind === "network") return { copy: RELEASE_UNCONFIRMED, http: false };
  if (answer.kind === "ok") {
    const { restatement } = answer.body;
    if (answer.body.outcome === "queued" && restatement.release_at) {
      return { copy: `Release queued — publishes at the ${isoWallClock(restatement.release_at, false)} ET session close on ${isoWallDate(restatement.release_at)}.`, http: true };
    }
    if (restatement.published_at) {
      return { copy: `Released — published at ${isoWallClock(restatement.published_at, true)} ET on ${isoWallDate(restatement.published_at)}.`, http: true };
    }
    return { copy: UNEXPECTED, http: true };
  }
  if (answer.code === "preparer_cannot_release" || answer.code === "clearer_cannot_release") return { copy: RELEASE_TWO_PERSON, http: true };
  if (answer.code === "invalid_transition") return { copy: RELEASE_NOT_CLEARED, http: true };
  return { copy: UNEXPECTED, http: true };
}

interface ReleaseProps {
  session: DialogSession;
  restatement: RestatementView;
  /** The outcome of a press, whichever dialog session sent it. */
  onOutcome: (copy: string, delivered: boolean) => void;
}

export function ReleaseDialog({ session, restatement, onOutcome }: ReleaseProps) {
  const checkbox = useFocusOnOpen<HTMLInputElement>();
  const [ticked, setTicked] = useState(false);
  const [timing, setTiming] = useState("");
  const [status, setStatus] = useState("");
  const [answered, setAnswered] = useState(false);
  const [sending, setSending] = useState(false);
  const key = useRef(randomKey());

  usePolling(async () => {
    const answer = await request<BoardResponse>("GET", "/api/board");
    if (answer.kind !== "ok") return;
    const { equity } = answer.body.clocks;
    setTiming(
      equity.status === "open" && equity.closes_at
        ? `Releasing now queues it to the ${isoWallClock(equity.closes_at, false)} ET session close on ${isoWallDate(equity.closes_at)}.`
        : RELEASE_RELEASED_NOW,
    );
  }, !session.closing);

  const press = async (): Promise<void> => {
    setSending(true);
    const answer = await request<ReleaseResponse>("POST", `/api/restatements/${restatement.id}/release`, { body: { confirm: true }, headers: { "Idempotency-Key": key.current } });
    const { copy, http } = releaseCopy(answer);
    const mine = session.isActive();
    if (mine) {
      setSending(false);
      setStatus(copy);
      if (http) setAnswered(true);
    }
    onOutcome(copy, mine);
  };

  return (
    <ModalFrame title="Release restatement" closing={session.closing} onCancel={session.cancel} onGone={session.gone}>
      <h2>Release restatement</h2>
      <dl>
        <dt>Week ending</dt>
        <dd className="mono">{restatement.week_ending}</dd>
        <dt>Prepared by</dt>
        <dd>{restatement.prepared_by.name}</dd>
        <dt>Cleared by</dt>
        <dd>{restatement.cleared_by?.name ?? "—"}</dd>
        <dt>Accession</dt>
        <dd className="mono">{restatement.accession ?? "—"}</dd>
      </dl>
      <p role="status" aria-label="Release timing">{timing}</p>
      <div className="check">
        <input id={`release-confirm-${session.id}`} type="checkbox" ref={checkbox} checked={ticked} onChange={(event) => setTicked(event.target.checked)} />
        <label htmlFor={`release-confirm-${session.id}`}>I confirm this restatement is cleared for release</label>
      </div>
      <p className="modal-status" role="status" aria-label="Release status">{status}</p>
      <div className="actions">
        <button type="button" onClick={session.cancel}>Cancel</button>
        <button type="button" className="primary" disabled={!ticked || answered || sending} onClick={() => void press()}>Release</button>
      </div>
    </ModalFrame>
  );
}

interface WithdrawProps {
  session: DialogSession;
  restatement: RestatementView;
  /** `delivered` is true when the dialog session that sent the note is still the open one. */
  onWithdraw: (note: string, delivered: () => boolean) => Promise<"http" | "network">;
}

export function WithdrawDialog({ session, restatement, onWithdraw }: WithdrawProps) {
  const field = useFocusOnOpen<HTMLTextAreaElement>();
  const [note, setNote] = useState("");
  const valid = note.length >= 10 && note.length <= 500;

  return (
    <ModalFrame title="Withdraw release" closing={session.closing} onCancel={session.cancel} onGone={session.gone}>
      <h2>Withdraw release</h2>
      <dl>
        <dt>Week ending</dt>
        <dd className="mono">{restatement.week_ending}</dd>
        <dt>Queued release time</dt>
        <dd className="mono">{restatement.release_at ? `${isoWallDate(restatement.release_at)} ${isoWallClock(restatement.release_at, true)} ET` : "—"}</dd>
      </dl>
      <div className="field">
        <label htmlFor={`withdraw-note-${session.id}`}>Withdraw note</label>
        <textarea id={`withdraw-note-${session.id}`} ref={field} value={note} onChange={(event) => setNote(event.target.value)} />
        <span className="hint">10 to 500 characters.</span>
      </div>
      <div className="actions">
        <button type="button" onClick={session.cancel}>Cancel</button>
        <button type="button" className="primary" disabled={!valid} onClick={() => void onWithdraw(note, session.isActive)}>Withdraw</button>
      </div>
    </ModalFrame>
  );
}

interface SignInProps {
  session: DialogSession;
  onSignedIn: (user: StaffUser, stillOpen: boolean) => void;
}

export function SignInDialog({ session, onSignedIn }: SignInProps) {
  const email = useFocusOnOpen<HTMLInputElement>();
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const answer = await request<{ user: StaffUser }>("POST", "/api/session", { body: { email: address, password } });
    const mine = session.isActive();
    if (answer.kind === "ok") {
      onSignedIn(answer.body.user, mine);
    } else if (mine) {
      setStatus(answer.kind === "refused" && answer.status === 401 ? SIGN_IN_FAILED : UNEXPECTED);
    }
  };

  return (
    <ModalFrame title="Sign in to continue" closing={session.closing} onCancel={session.cancel} onGone={session.gone}>
      <h2>Sign in to continue</h2>
      <p>{SESSION_ENDED_DIALOG}</p>
      <form onSubmit={(event) => void submit(event)} className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="field">
          <label htmlFor={`dialog-email-${session.id}`}>Email</label>
          <input id={`dialog-email-${session.id}`} type="email" ref={email} autoComplete="username" value={address} onChange={(event) => setAddress(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`dialog-password-${session.id}`}>Password</label>
          <input id={`dialog-password-${session.id}`} type="password" role="textbox" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <p className="modal-status" role="status" aria-label="Sign-in status">{status}</p>
        <div className="actions">
          <button type="button" onClick={session.cancel}>Cancel</button>
          <button type="submit" className="primary">Sign in</button>
        </div>
      </form>
    </ModalFrame>
  );
}
