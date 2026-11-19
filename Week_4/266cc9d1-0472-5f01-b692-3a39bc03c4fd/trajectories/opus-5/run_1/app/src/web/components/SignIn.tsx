import { useState, type FormEvent, type ReactNode } from "react";
import { ApiFailure, api } from "../lib/api.js";
import { useAnnounce } from "./LiveRegions.jsx";
import type { Staff } from "../lib/types.js";

export function SignIn({ onSignedIn }: { onSignedIn: (staff: Staff) => void }): ReactNode {
  const [accessCode, setAccessCode] = useState("");
  const [pending, setPending] = useState(false);
  const announce = useAnnounce();

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const result = await api<{ staff: Staff }>("POST", "/api/session", {
        body: { access_code: accessCode },
      });
      onSignedIn(result.staff);
    } catch (error) {
      const message =
        error instanceof ApiFailure && (error.status === 401 || error.status === 422)
          ? (error.fields.access_code ?? error.message)
          : "That access code is not recognised.";
      announce("Sign-in status", message);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="signin">
      <h1 className="wordmark">Spanwise</h1>
      <form className="signin__form" onSubmit={(event) => void onSubmit(event)}>
        <label className="field">
          <span className="field__label">Access code</span>
          <input
            className="field__input mono"
            type="text"
            autoComplete="off"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
          />
        </label>
        <button type="submit" className="button button--primary" aria-disabled={pending}>
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
