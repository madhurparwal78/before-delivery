// Sign in: email and password; success goes where the sign-in landing rule says.

import { useState, type ReactNode } from "react";
import type { User } from "../../shared/api.js";
import { landingFor } from "../../shared/landing.js";
import { call, NETWORK_COPY } from "../api.js";
import { useApp } from "../app.js";
import { errorNotice, Field, info, quiet, Status, type Notice } from "../components/ui.js";

export function SignIn(): ReactNode {
  const { location, navigate, setUser } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(quiet);

  return (
    <div className="signin">
      <div className="signin__plate" aria-hidden="true">
        <span className="signin__index">No. 1</span>
        <span className="signin__rule" />
      </div>
      <h1>Keel &amp; Bell rentals</h1>
      <p className="lede">Rent-to-own school instruments, catalogued by serial: reservations, agreements, equity and delivery days.</p>
      <form className="form signin__form" noValidate onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setNotice(info("Signing in…"));
        void call<{ user: User }>("POST", "/api/session", { email, password }).then((result) => {
          setBusy(false);
          if (result.ok) {
            setUser(result.data.user);
            navigate(landingFor(result.data.user.role, new URLSearchParams(location.search).get("next")), { replace: true });
          } else {
            setNotice(errorNotice(result.status === 401 ? "Email or password is wrong." : NETWORK_COPY));
          }
        });
      }}>
        <Field label="Email" htmlFor="signin-email">
          <input id="signin-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        </Field>
        <Field label="Password" htmlFor="signin-password">
          <input id="signin-password" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.currentTarget.value)} />
        </Field>
        <button type="submit" className="button button--primary" disabled={busy}>Sign in</button>
        <Status label="Sign-in status" notice={notice} />
      </form>
    </div>
  );
}
