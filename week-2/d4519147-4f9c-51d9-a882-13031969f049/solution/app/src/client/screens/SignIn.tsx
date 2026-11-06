import { useState } from "react";
import { landingFor } from "../../shared/next.ts";
import { errorBody, request } from "../api.ts";

export function SignIn({ next }: { next: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const res = await request({ method: "POST", path: "/api/session", json: { email, password } }, { allowUnauthenticated: true });
    if (res.ok) {
      // A full load, so the server answers the landing address (and 404 for a diagram this person cannot see).
      location.assign(landingFor(next));
      return;
    }
    setBusy(false);
    const code = (await errorBody(res))?.error;
    setAlert(code === "signin_locked" ? "Too many sign-in attempts. Try again later." : code === "invalid_credentials" ? "Email or password is incorrect." : "Something went wrong. Try again.");
  };

  return (
    <main className="center-screen">
      <section className="card signin-card">
        <p className="eyebrow">Plumbline Labs</p>
        <h1>Scopewright</h1>
        <p className="card-lede">Scoping diagrams for the cardholder data environment.</p>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input id="signin-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input id="signin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {alert && <div role="alert" className="form-alert">{alert}</div>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>Sign in</button>
        </form>
      </section>
    </main>
  );
}
