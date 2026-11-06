import { type ReactNode, useState } from "react";
import { api, Refusal, UNEXPECTED } from "./api";
import { Dialog } from "./dialog";
import { Icon } from "./icons";
import { MenuButton } from "./menu";
import { navigate } from "./router";
import type { User } from "./types";

export const ERASED_NOTICE = "erased";

function EraseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const erase = async () => {
    if (typed !== "ERASE") return setStatus("Type ERASE to confirm.");
    setBusy(true);
    setStatus("Erasing your account…");
    try {
      await api("/api/me", { method: "DELETE", body: { confirm: typed } });
      navigate("/sign-in", { notice: ERASED_NOTICE });
    } catch (error) {
      setBusy(false);
      const code = error instanceof Refusal ? error.code : "";
      setStatus(
        code === "storage_unavailable"
          ? "Storage is unreachable, so your account can't be erased right now. Nothing was removed."
          : code === "validation"
            ? "Type ERASE to confirm."
            : UNEXPECTED,
      );
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Erase your account?" role="alertdialog" destructive>
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void erase();
        }}
      >
        <p className="dialog-copy">
          Your account, your one-to-one projects and the checkpoints you made are removed for good. Mentors keep their own
          projects.
        </p>
        <label className="field">
          <span>Type ERASE to confirm</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <p role="status" aria-label="Account status" className="region">
          {status}
        </p>
        <div className="dialog-actions">
          <button type="button" className="button" data-cancel onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-danger" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            Erase account
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function AppHeader({ user, workspace = false, children }: { user: User; workspace?: boolean; children?: ReactNode }) {
  const [erasing, setErasing] = useState(false);
  const items = [
    { label: "All projects", onSelect: () => navigate("/") },
    {
      label: "Sign out",
      onSelect: () => {
        void api("/api/auth/sign-out", { method: "POST" }).finally(() => navigate("/sign-in"));
      },
    },
    ...(user.kind === "learner" ? [{ label: "Erase my account", onSelect: () => setErasing(true) }] : []),
  ];
  return (
    <header className={workspace ? "app-header app-header-workspace" : "app-header"}>
      {workspace && (
        <a
          className="skip-link"
          href="#code-editor"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById("code-editor")?.focus();
          }}
        >
          Skip to editor
        </a>
      )}
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Relay Bench</span>
      </div>
      <MenuButton label="Account" menuLabel="Account" items={items} className="button button-quiet account-button" align="end">
        <Icon name="account" />
        <span>Account</span>
      </MenuButton>
      {children}
      <EraseDialog open={erasing} onClose={() => setErasing(false)} />
    </header>
  );
}
