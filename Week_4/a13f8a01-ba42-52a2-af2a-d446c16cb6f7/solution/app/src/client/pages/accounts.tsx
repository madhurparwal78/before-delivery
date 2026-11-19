import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "../../shared/types.js";
import { ApiFailure, api } from "../api.js";
import { useAccount } from "../account.js";
import { Shell } from "../components/shell.js";
import { Link, navigate } from "../router.js";

const FIELDS = ["handle", "email", "password"] as const;

export function SignupPage(): React.JSX.Element {
  const account = useAccount();
  const [problems, setProblems] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (problems !== null) summary.current?.focus();
  }, [problems]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api.post("/api/signup", { handle: form.get("handle"), email: form.get("email"), password: form.get("password") });
      await account.refresh();
      navigate("/dashboard");
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.body.fields === undefined) throw error;
      setProblems(error.body.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <section className="form-page">
        <h1>Create your account</h1>
        {problems !== null && (
          <div role="alert" className="panel problem" ref={summary} tabIndex={-1}>
            <h2>There is a problem</h2>
            <ul>
              {FIELDS.filter((field) => problems[field] !== undefined).map((field) => (
                <li key={field}>
                  <a
                    href={`#signup-${field}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(`signup-${field}`)?.focus();
                    }}
                  >
                    {problems[field]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <form noValidate onSubmit={(event) => void submit(event)}>
          <label htmlFor="signup-handle">Handle</label>
          <input id="signup-handle" name="handle" type="text" autoComplete="username" autoCapitalize="off" spellCheck={false} />
          <label htmlFor="signup-email">Email</label>
          <input id="signup-email" name="email" type="email" autoComplete="email" />
          <label htmlFor="signup-password">Password</label>
          <input id="signup-password" name="password" type="password" autoComplete="new-password" />
          <button type="submit" className="button primary" disabled={busy} aria-busy={busy}>
            Create account
          </button>
        </form>
        <p className="form-note">
          Already have an account? <Link to="/signin">Sign in</Link>
        </p>
      </section>
    </Shell>
  );
}

export function SigninPage(): React.JSX.Element {
  const account = useAccount();
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api.post<{ user: User }>("/api/signin", { email: form.get("email"), password: form.get("password") });
      setProblem("");
      await account.refresh();
      navigate("/dashboard");
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setProblem(error.body.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <section className="form-page">
        <h1>Sign in</h1>
        {problem !== "" && (
          <div role="alert" className="panel problem">
            <p>{problem}</p>
          </div>
        )}
        <form noValidate onSubmit={(event) => void submit(event)}>
          <label htmlFor="signin-email">Email</label>
          <input id="signin-email" name="email" type="email" autoComplete="email" />
          <label htmlFor="signin-password">Password</label>
          <input id="signin-password" name="password" type="password" autoComplete="current-password" />
          <button type="submit" className="button primary" disabled={busy} aria-busy={busy}>
            Sign in
          </button>
        </form>
        <p className="form-note">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </section>
    </Shell>
  );
}

export function VerifyPage(): React.JSX.Element {
  const account = useAccount();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(location.search).get("token") ?? "";
    api
      .post("/api/verify", { token })
      .then(() => {
        setOutcome({ ok: true, message: "Your email is verified" });
        return account.refresh();
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setOutcome({ ok: false, message: error.body.message });
      });
  }, []);

  return (
    <Shell>
      <section className="form-page">
        {outcome === null ? (
          <p className="panel loading">Checking your link…</p>
        ) : (
          <>
            <h1>{outcome.message}</h1>
            <p>{outcome.ok ? "You can now save versions, publish, like and fork." : "Sign in to request a new link."}</p>
            <Link to={outcome.ok ? "/dashboard" : "/signin"} className="button primary">
              {outcome.ok ? "Open your dashboard" : "Sign in"}
            </Link>
          </>
        )}
      </section>
    </Shell>
  );
}
