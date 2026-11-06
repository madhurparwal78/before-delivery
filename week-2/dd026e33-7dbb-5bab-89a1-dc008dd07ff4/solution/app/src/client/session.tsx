// The signed-in user, their units, and Sign in again (brief: Interactions › Session end).
import { createContext, useContext, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { User } from "../shared/api.js";
import type { Units } from "../shared/units.js";
import { setSignInAgainOpen } from "./signInAgainState.js";
import { Dialog } from "./ui/Dialog.js";

interface Session {
  user: User;
  units: Units;
  setUnits: (units: Units) => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside a signed-in screen");
  return session;
}

/** Owns the Sign in again dialog: every caller that met session_expired waits on one sign-in. */
export function useSignInAgain(email: () => string): {
  request: () => Promise<void>;
  dialog: JSX.Element | null;
} {
  const [open, setOpen] = useState(false);
  const pending = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);

  const request = (): Promise<void> => {
    if (!pending.current) {
      let resolve: () => void = () => undefined;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      pending.current = { promise, resolve };
      setSignInAgainOpen(true);
      setOpen(true);
    }
    return pending.current.promise;
  };

  const finish = (): void => {
    // The dialog unmounts and returns focus before the interrupted actions resume.
    flushSync(() => setOpen(false));
    setSignInAgainOpen(false);
    const waiting = pending.current;
    pending.current = null;
    waiting?.resolve();
  };

  return { request, dialog: open ? <SignInAgainDialog email={email()} onSignedIn={finish} /> : null };
}

function SignInAgainDialog({ email, onSignedIn }: { email: string; onSignedIn: () => void }): JSX.Element {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (): Promise<void> => {
    setMessage("Signing in...");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "same-origin",
      });
      if (response.ok) {
        onSignedIn();
        return;
      }
    } catch {
      // No answer: the same refusal copy keeps the dialog open for another try.
    }
    setMessage("Email or password is wrong.");
  };

  return (
    <Dialog title="Sign in again" onClose={() => undefined} dismissible={false} initialFocus={passwordRef}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p>Your session has ended. Sign in again to carry on.</p>
        <p className="mono-text">{email}</p>
        <div className="field">
          <label htmlFor="again-password">Password</label>
          <input
            ref={passwordRef}
            id="again-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className={message === "Signing in..." ? "field-note" : "field-error"} aria-live="polite">
            {message}
          </p>
        </div>
        <div className="dialog-actions">
          <button type="submit" className="button primary">
            Sign in again
          </button>
        </div>
      </form>
    </Dialog>
  );
}
