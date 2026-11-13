import { useState, type FormEvent } from "react";
import { ApiError, api, explain, fieldErrors } from "../api";
import { navigate } from "../router";

export function Signin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (path: "login" | "signup"): Promise<void> => {
    setPending(true);
    setErrors({});
    setFailure(null);
    try {
      await api("POST", `/api/auth/${path}`, { username, password });
      navigate("/board");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setFailure("Wrong username or password.");
      else if (fieldErrors(error)) setErrors(fieldErrors(error)!);
      else setFailure(explain(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="signin">
      <section className="signin-pitch">
        <h1 className="signin-title">Deedfall</h1>
        <p>Keep your routines with friends. Every finished task lands a blow on a shared boss.</p>
      </section>
      <section className="signin-form">
        <form
          className="form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void submit("login");
          }}
        >
          <label className="field-label" htmlFor="signin-username">Username</label>
          <input id="signin-username" type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
          {errors.username && <p className="field-error" role="alert">{errors.username}</p>}
          <label className="field-label" htmlFor="signin-password">Password</label>
          <input id="signin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {errors.password && <p className="field-error" role="alert">{errors.password}</p>}
          {failure && <p className="field-error" role="alert">{failure}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-accent" disabled={pending}>Sign in</button>
            <button type="button" className="btn" disabled={pending} onClick={() => void submit("signup")}>Create account</button>
          </div>
        </form>
      </section>
    </main>
  );
}
