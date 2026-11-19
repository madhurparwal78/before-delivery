/** /holds/<id>: the holder's page with the quoted price, a countdown on the server's clock, release and share controls. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PublicHold } from "../shared/api-types.js";
import { COPY } from "../shared/copy.js";
import { api, errorOf, NetworkError, serverNow } from "./api.js";
import { useAuth } from "./auth.js";
import { Modal } from "./dialogs.js";
import { clockText, dollars, officeTime } from "./format.js";
import { useReread } from "./hooks.js";
import { useNotify } from "./notices.js";
import { Link } from "./router.js";

type Load = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; hold: PublicHold };

const CHECK_MS = 2_000;

export const HoldPage = ({ id }: { id: string }): ReactNode => {
  const { account, ready, openSignIn, sessionLost } = useAuth();
  const notify = useNotify();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [now, setNow] = useState(() => serverNow());
  const [releasing, setReleasing] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const announcedEnd = useRef<string | null>(null);
  const sequence = useRef(0);
  const releaseButton = useRef<HTMLButtonElement>(null);

  const read = useCallback(async (): Promise<void> => {
    if (!account || account.role !== "buyer") return;
    sequence.current += 1;
    const mine = sequence.current;
    try {
      const result = await api<{ hold: PublicHold }>("GET", `/api/holds/${encodeURIComponent(id)}`);
      if (mine !== sequence.current) return;
      if (result.status === 401) sessionLost();
      else if (result.ok) setLoad({ kind: "ready", hold: result.body.hold });
      else setLoad({ kind: "missing" });
      setNow(serverNow());
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
    }
  }, [account, id, sessionLost]);

  useEffect(() => {
    if (ready && !account) {
      setLoad({ kind: "loading" });
      openSignIn({ title: "Sign in" });
    }
  }, [ready, account, openSignIn]);

  useEffect(() => {
    void read();
  }, [read]);
  useReread(() => void read(), account?.role === "buyer");

  const hold = load.kind === "ready" ? load.hold : null;
  const active = hold?.status === "active";
  const remainingMs = hold ? new Date(hold.endsAt).getTime() - now : 0;

  // The countdown ticks once a second from the server's clock; zero only asks the server again.
  useEffect(() => {
    if (!active) return undefined;
    const tick = window.setInterval(() => setNow(serverNow()), 1000);
    return () => window.clearInterval(tick);
  }, [active]);

  const checking = active && remainingMs <= 0;
  useEffect(() => {
    if (!checking) return undefined;
    const ask = window.setInterval(() => void read(), CHECK_MS);
    void read();
    return () => window.clearInterval(ask);
  }, [checking, read]);

  // An ended hold: close dialogs, remove controls, announce the reason and move focus to the heading.
  useEffect(() => {
    if (!hold || hold.status === "active" || announcedEnd.current === hold.id) return;
    announcedEnd.current = hold.id;
    setConfirmRelease(false);
    if (hold.endedBy) notify(COPY.ended[hold.endedBy]);
    headingRef.current?.focus();
  }, [hold, notify]);

  const release = async (): Promise<void> => {
    if (!hold) return;
    setReleasing(true);
    setMessage("");
    try {
      const result = await api<{ hold: PublicHold }>("POST", `/api/holds/${hold.id}/release`, { json: {} });
      setConfirmRelease(false);
      if (result.ok) {
        announcedEnd.current = result.body.hold.id;
        setLoad({ kind: "ready", hold: result.body.hold });
        notify(COPY.holdReleased);
        headingRef.current?.focus();
      } else {
        setMessage(errorOf(result)?.message ?? "");
        void read();
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage(COPY.lostReply);
    } finally {
      setReleasing(false);
    }
  };

  const share = async (action: "create" | "revoke"): Promise<void> => {
    if (!hold) return;
    setBusy(action);
    setMessage("");
    try {
      if (action === "create") {
        const result = await api<{ shareUrl: string }>("POST", `/api/holds/${hold.id}/share`, { json: {} });
        if (result.ok) {
          setLoad({ kind: "ready", hold: { ...hold, shareUrl: result.body.shareUrl } });
          notify(COPY.shareReady);
        } else {
          setMessage(errorOf(result)?.message ?? "");
          void read();
        }
      } else {
        const result = await api("DELETE", `/api/holds/${hold.id}/share`);
        if (result.ok) {
          setLoad({ kind: "ready", hold: { ...hold, shareUrl: null } });
          notify(COPY.shareRevoked);
        } else {
          setMessage(errorOf(result)?.message ?? "");
        }
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage(COPY.lostReply);
    } finally {
      setBusy(null);
    }
  };

  const copy = async (): Promise<void> => {
    if (!hold?.shareUrl) return;
    setBusy("copy");
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${hold.shareUrl}`);
      notify(COPY.linkCopied);
    } catch {
      setMessage("Copy the link from the box above.");
    } finally {
      setBusy(null);
    }
  };

  if (load.kind === "missing") {
    return (
      <main className="hold-page">
        <h1 ref={headingRef} tabIndex={-1}>
          {COPY.holdNotFound}
        </h1>
        <p>
          <Link to="/finder" className="button">
            Open the finder
          </Link>
        </p>
      </main>
    );
  }
  if (!hold) return <main className="hold-page" aria-busy="true" />;

  return (
    <main className="hold-page">
      <h1 ref={headingRef} tabIndex={-1}>
        Your hold on {hold.unitCode}
      </h1>
      {active ? (
        <>
          <p className="hold-countdown figures">
            <span role="timer" aria-label="Time left on your hold">
              {checking ? "Checking..." : clockText(remainingMs / 1000)}
            </span>
          </p>
          <p className="figures">Quoted price {dollars(hold.quotedPrice)}</p>
          <p className="figures">Price version {hold.priceVersion}</p>
          <p className="figures">Held until {officeTime(hold.endsAt)}.</p>
          <div className="actions">
            <button ref={releaseButton} type="button" className="button" disabled={releasing} onClick={() => setConfirmRelease(true)}>
              Release hold
            </button>
          </div>
          <div className="share">
            {hold.shareUrl ? (
              <>
                <label htmlFor="share-link">Share link</label>
                <input id="share-link" type="text" readOnly role="textbox" value={`${window.location.origin}${hold.shareUrl}`} onFocus={(event) => event.currentTarget.select()} />
                <div className="actions">
                  <button type="button" className="button" disabled={busy !== null} onClick={() => void copy()}>
                    Copy link
                  </button>
                  <button type="button" className="button" disabled={busy !== null} onClick={() => void share("create")}>
                    Make a new link
                  </button>
                  <button type="button" className="button" disabled={busy !== null} onClick={() => void share("revoke")}>
                    Revoke link
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="button" disabled={busy !== null} onClick={() => void share("create")}>
                Create share link
              </button>
            )}
          </div>
          <p className="form-message" aria-live="polite">
            {message}
          </p>
        </>
      ) : (
        <>
          <p className="ended-copy">{hold.endedBy ? COPY.ended[hold.endedBy] : null}</p>
          <p>
            <Link to="/finder" className="button">
              Open the finder
            </Link>
          </p>
        </>
      )}
      {confirmRelease && active ? (
        <Modal
          label="Release this hold?"
          role="alertdialog"
          className="modal-confirm" scrim
          onClose={() => setConfirmRelease(false)}
          restoreFocus={() => releaseButton.current}
        >
          <h2>Release this hold?</h2>
          <p>{hold.unitCode} goes back on sale for every buyer.</p>
          <div className="actions">
            <button type="button" className="button primary-solid" disabled={releasing} onClick={() => void release()}>
              {releasing ? "Releasing..." : "Release"}
            </button>
            <button type="button" className="button" onClick={() => setConfirmRelease(false)}>
              Keep hold
            </button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
};
