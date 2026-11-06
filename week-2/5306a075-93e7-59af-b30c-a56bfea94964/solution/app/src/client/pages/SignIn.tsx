import { useId, useState } from "react";
import type { User } from "../../shared/api.js";
import { api, isFailure } from "../api.js";
import { MessageSlot, useFeedback } from "../feedback.js";
import { navigate } from "../router.js";
import { RoadmapOrnament } from "../art.js";

export function SignInPage() {
  const feedback = useFeedback();
  const id = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    feedback.clearAlert();
    try {
      await api.post<{ user: User }>("/api/session", { email, password });
      navigate("/inbox");
    } catch (error) {
      if (isFailure(error, 401)) feedback.warn("Email or password is incorrect.");
      else feedback.fail(error);
      setBusy(false);
    }
  };

  return (
    <div className="solo">
      <MessageSlot />
      <main className="solo-card">
        <RoadmapOrnament />
        <h1>Sign in to Evidence Desk</h1>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="field">
            <label htmlFor={`${id}-email`}>Email</label>
            <input id={`${id}-email`} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor={`${id}-password`}>Password</label>
            <input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="button button-wide" aria-busy={busy} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </main>
    </div>
  );
}
