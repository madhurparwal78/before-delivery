import { useRef, useState } from "react";
import { announce } from "../store/announcer.ts";
import type { AccountSession } from "../store/deviceStore.ts";
import { signedIn } from "../store/sync.ts";
import { Dialog } from "./common.tsx";

type Action = "sign-in" | "create";
type FieldErrors = { email?: string; password?: string; form?: string };

const UNREACHABLE = "We could not reach the server. Nothing has changed on this device.";

export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState<Action | null>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);

  const fail = (found: FieldErrors): void => {
    setErrors(found);
    announce(Object.values(found).join(" "));
    if (found.password && !found.email) passwordField.current?.focus();
    else emailField.current?.focus();
  };
  const submit = async (action: Action): Promise<void> => {
    setPending(action);
    setErrors({});
    const answer = await fetch(action === "create" ? "/api/accounts" : "/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    setPending(null);
    if (!answer || answer.status === 503) return fail({ form: UNREACHABLE });
    if (!answer.ok) return fail(((await answer.json()) as { errors: FieldErrors }).errors);
    onClose();
    signedIn((await answer.json()) as AccountSession);
  };

  return (
    <Dialog name="Sign in" onClose={onClose}>
      <form noValidate onSubmit={(event) => { event.preventDefault(); void submit("sign-in"); }}>
        <label className="field">
          <span>Email</span>
          <input ref={emailField} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        {errors.email && <p className="field-error">{errors.email}</p>}
        <label className="field">
          <span>Password</span>
          <input ref={passwordField} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {errors.password && <p className="field-error">{errors.password}</p>}
        {errors.form && <p className="field-error">{errors.form}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button" disabled={pending !== null} aria-busy={pending === "sign-in"}>{pending === "sign-in" ? "Signing in..." : "Sign in"}</button>
          <button type="button" className="button" disabled={pending !== null} aria-busy={pending === "create"} onClick={() => void submit("create")}>{pending === "create" ? "Creating account..." : "Create account"}</button>
          <button type="button" className="button" onClick={onClose}>Close</button>
        </div>
      </form>
    </Dialog>
  );
}
