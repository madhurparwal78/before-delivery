import { useState, type FormEvent } from "react";
import type { HostSessionResponse } from "../../shared/api.js";
import { post } from "../api.js";
import { TextField } from "../components/Fields.js";
import { Page } from "../components/Shell.js";
import { navigate } from "../router.js";

const SESSION_ENDED = "Your session has ended. Sign in again to continue.";
const INVALID = "That email and password don't match.";

/** After sign-in go to `next` when it is a same-origin path beginning /host; otherwise to /host. */
function hostDestination(next: string | null): string {
  return next !== null && /^\/host(?:[/?#]|$)/.test(next) ? next : "/host";
}

export function HostSignInPage({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const ended = params.get("ended") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    const outcome = await post<HostSessionResponse>("/api/host/session", { email, password });
    setPending(false);
    if (outcome.ok) navigate(hostDestination(params.get("next")));
    else setError(INVALID);
  };

  return (
    <Page summary="Host sign-in" narrow>
      {ended && (
        <p role="status" aria-label="Sign-in notice" className="notice">
          {SESSION_ENDED}
        </p>
      )}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <TextField id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" />
        <TextField id="password" label="Password" type="password" value={password} onChange={setPassword} error={error ?? undefined} autoComplete="current-password" />
        <button type="submit" className="button button-solid" aria-disabled={pending}>
          Sign in
        </button>
      </form>
    </Page>
  );
}
