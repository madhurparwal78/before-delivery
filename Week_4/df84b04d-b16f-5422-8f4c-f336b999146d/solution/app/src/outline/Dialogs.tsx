import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessRemoved, deleteSentence, invitationNotSent, invitationSent } from "../../shared/copy";
import type { ShareRow, ShareStatus } from "../../shared/types";
import { ApiFailure, del, get, post } from "../lib/api";
import { announce, refuse } from "../lib/announce";
import { openDialog } from "../lib/dialog";
import { bulletLabel } from "../../shared/text";
import type { OutlineController } from "./controller";

export function DeleteDialog({ controller, id }: { controller: OutlineController; id: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const bullet = controller.state.view.bullets.get(id);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    const dispose = openDialog(element, null, () => controller.cancelDelete());
    cancel.current?.focus();
    return dispose;
  }, [controller]);

  return (
    <dialog ref={dialog} className="dialog" aria-label="Delete bullet">
      <p className="dialog-text">{deleteSentence(bulletLabel(bullet === undefined ? "" : controller.textOf(bullet)), controller.insideCount(id))}</p>
      <div className="dialog-actions">
        <button type="button" className="pill pill-quiet" ref={cancel} onClick={() => dialog.current?.dispatchEvent(new Event("cancel", { cancelable: true }))}>Cancel</button>
        <button type="button" className="pill pill-sky" onClick={() => controller.confirmDelete()}>Delete</button>
      </div>
    </dialog>
  );
}

const WORDS: Record<ShareStatus, string> = {
  pending_send: "Sending", sent: "Sent", not_sent: "Not sent", accepted: "Accepted", lapsed: "Expired", revoked: "Closed",
};

export function ShareDialog({ controller, bulletId }: { controller: OutlineController; bulletId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    const dispose = openDialog(element, document.querySelector<HTMLElement>('[aria-label="Share"]'), () => controller.setSharing(false));
    field.current?.focus();
    void get<{ shares: ShareRow[] }>(`/api/bullets/${encodeURIComponent(bulletId)}/shares`).then((found) => setShares(found.shares));
    return dispose;
  }, [controller, bulletId]);

  const outcome = (share: ShareRow) => {
    if (share.status === "sent") announce(invitationSent(share.email));
    else if (share.status === "not_sent") refuse(invitationNotSent(share.email));
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (sending !== null) return;
    const typed = email.trim().toLowerCase();
    setSending(typed);
    setError(undefined);
    try {
      const { share } = await post<{ share: ShareRow }>(`/api/bullets/${encodeURIComponent(bulletId)}/shares`, { email });
      setShares((current) => [...current.filter((entry) => entry.id !== share.id), share]);
      setEmail("");
      outcome(share);
    } catch (failure) {
      if (failure instanceof ApiFailure && (failure.status === 422 || failure.code === "already_invited")) {
        setError(failure.errors.email ?? failure.notice);
      } else throw failure;
    } finally {
      setSending(null);
    }
  };

  const retry = async (share: ShareRow) => {
    setRetrying(share.id);
    try {
      const result = await post<{ share: ShareRow }>(`/api/shares/${share.id}/retry`);
      setShares((current) => current.map((entry) => (entry.id === share.id ? { ...entry, status: result.share.status } : entry)));
      outcome(result.share);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 409) refuse(failure.notice);
      else throw failure;
    } finally {
      setRetrying(null);
    }
  };

  const remove = async (share: ShareRow) => {
    try {
      await del(`/api/shares/${share.id}`);
      announce(accessRemoved(share.email));
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 409) refuse(failure.notice);
      else throw failure;
    }
    setShares((current) => current.filter((entry) => entry.id !== share.id));
  };

  const close = () => dialog.current?.dispatchEvent(new Event("cancel", { cancelable: true }));

  return (
    <dialog ref={dialog} className="dialog dialog-share" aria-labelledby="share-title">
      <h2 id="share-title" className="dialog-title">Share bullet</h2>
      <form onSubmit={(event) => void send(event)} noValidate>
        <div className="field">
          <label htmlFor="share-email">Collaborator email</label>
          <input
            id="share-email" ref={field} type="email" value={email} autoComplete="off" data-native-undo=""
            aria-invalid={error !== undefined} aria-describedby={error === undefined ? undefined : "share-error"}
            onChange={(event) => setEmail(event.target.value)}
          />
          {error !== undefined && <p className="field-error" id="share-error">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button type="submit" className="pill pill-sky" disabled={sending !== null} aria-busy={sending !== null}>
            {sending === null ? "Send invitation" : "Sending"}
          </button>
          <button type="button" className="pill pill-quiet" onClick={close}>Close</button>
        </div>
      </form>
      <ul className="invitations" aria-label="Invitations">
        {shares.map((share) => {
          const busy = retrying === share.id;
          return (
            <li key={share.id} className="invitation">
              <span className="invitation-email">{share.email}</span>
              <span className="invitation-status">{busy ? "Sending" : WORDS[share.status]}</span>
              <span className="invitation-actions">
                {share.status === "not_sent" && !busy && (
                  <button type="button" className="mini" aria-label={`Retry invitation to ${share.email}`} onClick={() => void retry(share)}>Retry</button>
                )}
                <button type="button" className="mini" aria-label={`Remove access for ${share.email}`} onClick={() => void remove(share)}>Remove</button>
              </span>
            </li>
          );
        })}
        {sending !== null && (
          <li className="invitation"><span className="invitation-email">{sending}</span><span className="invitation-status">Sending</span></li>
        )}
      </ul>
    </dialog>
  );
}
