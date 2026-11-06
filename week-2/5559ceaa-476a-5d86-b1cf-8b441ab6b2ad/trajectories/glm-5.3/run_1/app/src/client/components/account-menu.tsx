import { useEffect, useRef, useState } from "react";
import { api, ApiCallError } from "../lib/api";

export function AccountMenu({
  user,
  onSignOut,
  onErased,
  showErase,
}: {
  user: { id: string; name: string; email: string | null; kind: string };
  onSignOut: () => void;
  onErased: () => void;
  showErase: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const erase = async () => {
    if (pending) return;
    if (confirmText !== "ERASE") {
      setStatus("Type ERASE to confirm.");
      return;
    }
    setPending(true);
    setStatus("Erasing your account…");
    try {
      await api("DELETE", "/api/me", { confirm: confirmText });
      onErased();
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "storage_unavailable") {
          setStatus("Storage is unreachable, so your account can't be erased right now. Nothing was removed.");
        } else if (err.code === "forbidden") {
          setStatus("Mentor accounts cannot be erased.");
        } else if (err.code === "validation") {
          setStatus("Type ERASE to confirm.");
        } else {
          setStatus("Something went wrong. Try again.");
        }
      } else {
        setStatus("Something went wrong. Try again.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Account
      </button>
      {open ? (
        <div ref={menuRef} role="menu" aria-label="Account" className="account-menu">
          <div className="account-name">{user.name}</div>
          <button role="menuitem" onClick={() => { setOpen(false); void onSignOut(); }}>
            Sign out
          </button>
          {showErase ? (
            <button role="menuitem" onClick={() => { setOpen(false); setConfirmOpen(true); }}>
              Erase my account
            </button>
          ) : null}
        </div>
      ) : null}
      {confirmOpen ? (
        <div className="dialog-backdrop destructive" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setConfirmOpen(false);
        }}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Erase your account?"
            className="dialog"
            ref={(node) => {
              const cancel = node?.querySelector<HTMLElement>('[data-autofocus="cancel"]');
              cancel?.focus();
            }}
          >
            <h2>Erase your account?</h2>
            <p>Your account, projects and checkpoints are removed for good.</p>
            <label htmlFor="erase-confirm">Type ERASE to confirm</label>
            <input
              id="erase-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            <div className="dialog-actions">
              <button data-autofocus="cancel" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button className="danger" onClick={erase} disabled={pending}>
                Erase account
              </button>
            </div>
            <p className="status" role="status" aria-label="Account status">{status}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
