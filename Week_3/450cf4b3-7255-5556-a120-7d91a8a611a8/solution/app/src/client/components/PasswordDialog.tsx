// "Confirm your password": the step-up dialog for pack purchases and refunds. `ask` resolves true once the
// server has recorded a fresh confirmation, false when the dialog is closed without one.

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api.js";
import { GENERIC, passwordCopy } from "../copy.js";
import { Modal } from "../modal.js";
import { Icon, Notice, tell, type NoticeState } from "../ui.js";

interface Asking {
  opener: HTMLElement;
  settle: (confirmed: boolean) => void;
}

function PasswordDialog({ opener, onDone }: { opener: HTMLElement; onDone: (confirmed: boolean) => void }): JSX.Element {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [refused, setRefused] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (refused > 0) field.current?.focus();
  }, [refused]);

  const submitPassword = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(tell(passwordCopy.pending));
    const result = await api("POST", "/api/session/confirm", { json: { password } });
    if (result.ok) {
      onDone(true);
      return;
    }
    setBusy(false);
    setPassword("");
    if (result.status === 401 || result.status === 422 || result.status === 429) {
      const text = result.status === 429 ? passwordCopy.limit : passwordCopy.wrong;
      setError(text);
      setNotice(tell(text, "conflict"));
      setRefused((n) => n + 1);
    } else {
      setNotice(tell(GENERIC, "outage"));
    }
  };

  return (
    <Modal label="Confirm your password" opener={opener} onClose={() => { if (!busy) onDone(false); }}>
      <form class="password" onSubmit={(e) => { e.preventDefault(); void submitPassword(); }} noValidate>
        <p>{passwordCopy.prompt}</p>
        <div class="field">
          <label for="confirm-password">Password</label>
          <input id="confirm-password" ref={field} type="password" autoComplete="current-password" value={password}
            aria-invalid={error ? "true" : undefined} aria-describedby={error ? "confirm-password-error" : undefined}
            onInput={(e) => setPassword(e.currentTarget.value)} />
          {error ? <p class="field__error" id="confirm-password-error">{error}</p> : null}
        </div>
        <div class="actions">
          <button type="submit" class="button button--ink" disabled={busy}>Confirm</button>
          <button type="button" class="button" disabled={busy} onClick={() => onDone(false)}><Icon name="x" />Close</button>
        </div>
        <Notice notice={notice} />
      </form>
    </Modal>
  );
}

export function usePasswordConfirm(): { ask: (opener: HTMLElement) => Promise<boolean>; dialog: JSX.Element | null } {
  const [asking, setAsking] = useState<Asking | null>(null);
  const ask = (opener: HTMLElement): Promise<boolean> => new Promise((resolve) => setAsking({ opener, settle: resolve }));
  const dialog = asking ? (
    <PasswordDialog opener={asking.opener} onDone={(confirmed) => {
      setAsking(null);
      asking.settle(confirmed);
    }} />
  ) : null;
  return { ask, dialog };
}
