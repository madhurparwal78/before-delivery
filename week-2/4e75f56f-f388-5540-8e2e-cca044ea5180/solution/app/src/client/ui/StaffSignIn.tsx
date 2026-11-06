import { useLayoutEffect, useState } from "preact/hooks";
import { call, type Account, type Me, type Role } from "../api.js";
import { Field } from "./kit.js";

/** An inline sign-in form for pages that need an account. */
export function StaffSignIn({ heading, onSignedIn }: { heading: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: Event) => {
    event.preventDefault();
    const reply = await call<{ account: Account }>("POST", "/api/auth/signin", { email, password });
    if (reply.ok) onSignedIn();
    else setError(reply.error.error === "invalid_credentials" ? "Email or password is incorrect." : reply.error.message);
  };
  return (
    <form class="form card signin-card" onSubmit={submit} noValidate>
      <h2 class="card__title">{heading}</h2>
      {error && (
        <p class="form__error" role="alert">
          {error}
        </p>
      )}
      <Field id="page-email" label="Email" type="email" autocomplete="email" value={email} onInput={setEmail} />
      <Field id="page-password" label="Password" type="password" autocomplete="current-password" value={password} onInput={setPassword} />
      <div class="form__actions">
        <button type="submit" class="button button--primary">
          Sign in
        </button>
      </div>
    </form>
  );
}

/** The signed-in account for a staff page, or null until someone with `role` signs in. */
export function useStaff(role: Role): { me: Me | null | undefined; refresh: () => void } {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const refresh = () => {
    void call<Me>("GET", "/api/me").then((reply) => setMe(reply.ok ? reply.data : null));
  };
  useLayoutEffect(refresh, []);
  return { me: me && me.account.role !== role ? null : me, refresh };
}
