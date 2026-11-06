import { useEffect, useRef, useState } from "react";
import { announce } from "../announce.tsx";
import { editorRequest, errorBody, readJson, request, resume, sessionInfo } from "../api.ts";
import { Modal } from "../modal.tsx";

interface Share {
  id: string;
  email: string;
  displayName: string | null;
  role: "editor" | "viewer";
  status: "invited" | "expired" | "active";
  delivery: "sent" | "queued";
  expiresAt: string | null;
}

const REFRESH_MS = 10_000;

const EMAIL_ERRORS: Record<string, string> = {
  validation: "Enter a valid email address.",
  already_member: "This person already has access.",
  invite_pending: "An invitation to this email is already pending.",
  invite_rate_limited: "Too many invitations sent. Try again later.",
};

function rowStatus(s: Share): string {
  if (s.status === "active") return s.role === "editor" ? "Editor" : "Viewer";
  if (s.status === "expired") return "Expired";
  return s.delivery === "sent" ? "Invited" : "Not yet delivered";
}

export function ShareDialog({ diagramId, ownerName, onClose, onFailure }: { diagramId: string; ownerName: string; onClose(): void; onFailure(): void }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState<Share | null>(null);
  const sendingRef = useRef(false);
  const known = useRef<Map<string, Share> | null>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const focusAfterConfirm = useRef<HTMLElement | null>(null);

  /** Updates rows in place by id, announcing a row that became delivered or expired, once per transition. */
  const adopt = (next: Share[], fromRefresh: boolean) => {
    const before = known.current;
    if (before && fromRefresh) {
      for (const s of next) {
        const old = before.get(s.id);
        if (!old) continue;
        if (old.status === "invited" && old.delivery === "queued" && s.status === "invited" && s.delivery === "sent") announce(`Invitation delivered to ${s.email}.`);
        if (old.status === "invited" && s.status === "expired") announce(`Invitation expired for ${s.email}.`);
      }
      const active = document.activeElement;
      const row = active instanceof HTMLElement ? active.closest<HTMLElement>("[data-share]") : null;
      if (row && !next.some((s) => s.id === row.dataset.share)) queueMicrotask(() => emailRef.current?.focus());
    }
    known.current = new Map(next.map((s) => [s.id, s]));
    setShares(next);
  };

  const load = async (fromRefresh: boolean) => {
    if (resume.open) return;
    const res = await request({ method: "GET", path: `/api/diagrams/${diagramId}/shares` });
    if (res.ok) adopt((await readJson<{ shares: Share[] }>(res)).shares, fromRefresh);
  };

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(timer);
    // The list loads when the dialog opens and refreshes on its own interval.
  }, []);

  /** After a removal: the next row's first control, else the previous row's, else Email. */
  const focusAfterRemoval = (removedId: string) => {
    const list = shares ?? [];
    const index = list.findIndex((s) => s.id === removedId);
    const next = list[index + 1] ?? (index > 0 ? list[index - 1] : undefined);
    return () => {
      const target = next ? tableRef.current?.querySelector<HTMLElement>(`[data-share="${next.id}"] select, [data-share="${next.id}"] button`) : null;
      (target ?? emailRef.current)?.focus();
    };
  };

  const send = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const res = await editorRequest({ method: "POST", path: `/api/diagrams/${diagramId}/shares`, json: { email, role } });
    sendingRef.current = false;
    setSending(false);
    if (res.status === 201) {
      const { share } = await readJson<{ share: Share }>(res);
      setEmailError(null);
      setEmail("");
      announce(`Invitation created for ${share.email}.`);
      adopt([...(shares ?? []).filter((s) => s.id !== share.id), share], false);
      return;
    }
    const code = (await errorBody(res))?.error;
    if (code && EMAIL_ERRORS[code]) setEmailError(EMAIL_ERRORS[code]);
    else onFailure();
    emailRef.current?.focus();
  };

  const changeRole = async (share: Share, next: "editor" | "viewer") => {
    setShares((list) => list?.map((s) => (s.id === share.id ? { ...s, role: next } : s)) ?? null);
    const res = await editorRequest({ method: "PATCH", path: `/api/diagrams/${diagramId}/shares/${share.id}`, json: { role: next } });
    if (res.ok) {
      const updated = (await readJson<{ share: Share }>(res)).share;
      adopt((shares ?? []).map((s) => (s.id === updated.id ? updated : s)), false);
      announce(`Access updated for ${share.email}.`);
    } else {
      void load(false);
      onFailure();
    }
  };

  const removeShare = async (share: Share, withdraw: boolean) => {
    const then = focusAfterRemoval(share.id);
    const res = await editorRequest({ method: "DELETE", path: `/api/diagrams/${diagramId}/shares/${share.id}` });
    if (res.status === 204) {
      adopt((shares ?? []).filter((s) => s.id !== share.id), false);
      announce(withdraw ? `Invitation withdrawn for ${share.email}.` : `Removed ${share.email}.`);
      queueMicrotask(then);
    } else {
      void load(false);
      onFailure();
    }
  };

  return (
    <Modal kind="dialog" label="Share diagram" onClose={onClose} className="dialog-wide">
      <header className="dialog-head"><h2>Share diagram</h2></header>
      <form
        className="invite-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="field">
          <label htmlFor="share-email">Email</label>
          <input
            id="share-email"
            ref={emailRef}
            type="email"
            autoComplete="off"
            value={email}
            aria-describedby={emailError ? "share-email-error" : undefined}
            aria-invalid={emailError ? true : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
          {emailError && <p className="field-error" id="share-email-error">{emailError}</p>}
        </div>
        <div className="field">
          <label htmlFor="share-role">Role</label>
          <select id="share-role" value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={sending}>{sending ? "Sending..." : "Send invitation"}</button>
      </form>
      <div className="table-wrap">
        <table aria-label="People with access" className="data-table">
          <thead><tr><th scope="col">Person</th><th scope="col">Access</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody ref={tableRef}>
            <tr>
              <td>
                <span className="person-name">{ownerName}</span>
                {/* Only the owner opens this dialog, so the signed-in person is the owner. */}
                {sessionInfo.user && <span className="person-email">{sessionInfo.user.email}</span>}
              </td>
              <td><span className="chip">Owner</span></td>
              <td />
            </tr>
            {(shares ?? []).map((s) => (
              <tr key={s.id} data-share={s.id}>
                <td>
                  {s.displayName && <span className="person-name">{s.displayName}</span>}
                  <span className="person-email">{s.email}</span>
                </td>
                <td>
                  {s.status === "active" ? (
                    <select
                      aria-label={`Role for ${s.email}`}
                      value={s.role}
                      onChange={(e) => void changeRole(s, e.target.value as "editor" | "viewer")}
                      onKeyDown={(e) => {
                        // Arrow keys change the role at once on every platform, one change per changed value.
                        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                        e.preventDefault();
                        const next = e.key === "ArrowDown" ? "viewer" : "editor";
                        if (next !== s.role) void changeRole(s, next);
                      }}
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span className={`chip${s.status === "expired" ? " chip-muted" : ""}`}>{rowStatus(s)}</span>
                  )}
                </td>
                <td className="cell-actions">
                  {s.status === "active" ? (
                    <button type="button" className="btn btn-small" aria-label={`Remove ${s.email}`} onClick={(e) => {
                      focusAfterConfirm.current = e.currentTarget;
                      setConfirm(s);
                    }}>Remove</button>
                  ) : (
                    <button type="button" className="btn btn-small" aria-label={`Withdraw invitation for ${s.email}`} onClick={() => void removeShare(s, true)}>Withdraw</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shares === null && <div className="skeleton-rows" aria-hidden="true"><span /><span /><span /></div>}
      </div>
      <footer className="dialog-foot"><button type="button" className="btn" onClick={onClose}>Close</button></footer>
      {confirm && (
        <RemoveConfirm
          email={confirm.email}
          returnTo={() => focusAfterConfirm.current}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const share = confirm;
            focusAfterConfirm.current = null;
            setConfirm(null);
            void removeShare(share, false);
          }}
        />
      )}
    </Modal>
  );
}

function RemoveConfirm({ email, onCancel, onConfirm, returnTo }: { email: string; onCancel(): void; onConfirm(): void; returnTo(): HTMLElement | null }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal kind="alertdialog" label="Remove access" onClose={onCancel} initialFocus={cancelRef} returnFocus={returnTo} className="dialog-narrow">
      <header className="dialog-head"><h2>Remove access</h2></header>
      <p className="dialog-text">{email} will lose access to this diagram at their next request and receive an access-changed email.</p>
      <footer className="dialog-foot">
        <button type="button" className="btn btn-primary" onClick={onConfirm}>Remove access</button>
        <button type="button" ref={cancelRef} className="btn" onClick={onCancel}>Cancel</button>
      </footer>
    </Modal>
  );
}
