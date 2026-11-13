import { useRef, useState } from "react";
import type { SessionUser } from "../../shared/api";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { useAction } from "../lib/actions";
import { apiDelete, apiSignIn } from "../lib/api";
import { PENDING } from "../lib/copy";
import { finishSignIn } from "../lib/session";

interface SessionEndedProps {
  user: SessionUser;
  onSignedOut: () => void;
}

/** Sign in to continue: signing in again resends the action that found the session ended; signing out drops it. */
export function SessionEndedDialog({ user, onSignedOut }: SessionEndedProps) {
  const action = useAction();
  const [password, setPassword] = useState("");
  const passwordInput = useRef<HTMLInputElement>(null);

  const signInAgain = async (event: React.FormEvent) => {
    event.preventDefault();
    const answer = await action.run({
      kind: "sign_in",
      pending: PENDING.sign_in,
      work: () => apiSignIn(user.email, password),
      success: () => "",
      onFailure: () => {
        setPassword("");
        passwordInput.current?.focus();
      },
    });
    if (answer !== undefined) finishSignIn(true);
  };

  const signOut = async () => {
    await apiDelete("/api/session").catch(() => undefined);
    finishSignIn(false);
    onSignedOut();
  };

  return (
    <Modal
      label="Sign in to continue"
      onClose={() => undefined}
      closable={false}
      initialFocus={() => passwordInput.current}
      fallbackFocus={() => document.querySelector<HTMLElement>("[data-detail-heading]")}
    >
      <form className="dialog-form" noValidate onSubmit={(event) => void signInAgain(event)}>
        <h2 className="dialog-title">Sign in to continue</h2>
        <p className="dialog-note">Your session has ended. Sign in again to finish this action.</p>
        <p className="dialog-note">{user.email}</p>
        <Field id="sc-password" label="Password">
          {(props) => (
            <input {...props} ref={passwordInput} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          )}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn--primary" disabled={action.pending}>
            {action.pending ? PENDING.sign_in : "Sign in and continue"}
          </button>
          <button type="button" className="btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </form>
    </Modal>
  );
}
