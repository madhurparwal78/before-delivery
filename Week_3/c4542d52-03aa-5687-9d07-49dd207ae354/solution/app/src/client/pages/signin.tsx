import { useEffect, useState, type FormEvent } from "react";
import type { Me } from "../../shared/types.js";
import { groupThousands } from "../../shared/format.js";
import { ApiFailure, api } from "../api.js";

let titleRevealed = false;

export function SignInPage({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [total, setTotal] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal] = useState(() => {
    const first = !titleRevealed;
    titleRevealed = true;
    return first;
  });

  useEffect(() => {
    api<{ fully_diluted_total: number }>("GET", "/api/masthead").then((body) => setTotal(body.fully_diluted_total));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/api/session", { email, password });
      onSignedIn(await api<Me>("GET", "/api/me"));
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      setError(failure.body.error.message);
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <section className="mosaic" aria-label="Tidecraft Robotics">
        <img className="tile-photo m-a" src="/photos/robot-arm-lab.jpg" alt="" />
        <div className="tile-flat m-b flat-red" />
        <img className="tile-photo m-c" src="/photos/workbench.jpg" alt="" />
        <div className="tile-flat m-d flat-ink mosaic-count">
          <p className="mosaic-figure">{total === null ? "" : groupThousands(total)}</p>
          <p className="mosaic-caption">shares, fully diluted</p>
        </div>
        <div className="tile-flat m-e flat-grey" />
        <img className="tile-photo m-f" src="/photos/robot-arm-library.jpg" alt="" />
        <img className="tile-photo m-g" src="/photos/hands-at-desk.jpg" alt="" />
        <div className="tile-flat m-h flat-red" />
      </section>
      <div className="signin-grid">
        <h1 className={`title${reveal ? " title-reveal" : ""}`}>
          <span className="title-line">
            <span className="title-text">Your shares,</span>
          </span>{" "}
          <span className="title-line">
            <span className="title-text">on the record.</span>
          </span>
        </h1>
        <p className="standfirst">
          Tidecraft Robotics keeps its register here. Sign in to see what you own, what vests next and every deadline that applies to you.
        </p>
        <form className="form-column signin-form" onSubmit={(event) => void submit(event)} aria-label="Sign in">
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input id="signin-email" type="text" inputMode="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input id="signin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Signing in" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
