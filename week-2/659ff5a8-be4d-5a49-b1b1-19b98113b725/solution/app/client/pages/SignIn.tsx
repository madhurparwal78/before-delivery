import { type FormEvent, useState } from "react";
import type { SessionUser } from "../../shared/api.js";
import { ApiFailure, api } from "../api.js";
import { ConeMark } from "../components/ui.js";
import { useNavigation } from "../router.js";
import { useSession } from "../session.js";

export function SignIn() {
  const { setUser } = useSession();
  const { navigate } = useNavigation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setMessage("Signing in");
    try {
      const { user } = await api.post<{ user: SessionUser }>("/api/session", { email, password });
      setUser(user);
      navigate(user.roles.includes("operator") ? "/operator" : "/events");
    } catch (error) {
      setMessage(error instanceof ApiFailure && error.status === 401 ? "Email or password is incorrect." : "Could not sign in. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth main" id="main">
      <div className="auth-card">
        <div className="auth-brand">
          <ConeMark size={32} />
          <span>Conecount Paddock</span>
        </div>
        <h1>Sign in to Conecount Paddock</h1>
        <form aria-label="Sign in" onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input id="signin-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              type="password"
              role="textbox"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {message ? (
            <div role="alert" className="form-alert">
              {message}
            </div>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
