import { useEffect, useState, type FormEvent } from "react";
import { homeScreen } from "../../shared/types.js";
import { ApiFailure, post } from "../lib/api.js";
import { navigate } from "../lib/router.js";
import { useSession } from "../lib/session.js";
import { Button, Page, Rest } from "../lib/ui.js";

export function Login(): JSX.Element {
  const session = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (session.user) navigate(homeScreen(session.user.roles), true);
  }, [session.user]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      const result = await post<{ user: { roles: string[] } }>("/api/session", { username, password });
      await session.refresh();
      navigate(homeScreen(result.user.roles));
    } catch (error) {
      setFailed(error instanceof ApiFailure ? error.message : "That username and password do not match.");
      setBusy(false);
    }
  };

  return (
    <Page subject="Sign in">
      <Rest narrow>
        <form onSubmit={(event) => void submit(event)} className="stack">
          <label className="field">
            <span className="field-label">Username</span>
            <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <Button type="submit" busy={busy} disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </Button>
          {failed ? (
            <p className="form-error" role="alert">
              {failed}
            </p>
          ) : null}
        </form>
      </Rest>
    </Page>
  );
}
