import { useState, type FormEvent } from "react";
import { TextField } from "../components/Fields";
import { ApiFail, api } from "../lib/api";
import { Link, navigate, useParams } from "../lib/router";
import { refreshCart, refreshMe, refreshWishlist } from "../lib/store";
import "../styles/shop.css";

/** Only same-site paths are followed after signing in. */
export function nextPath(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function afterSignIn(next: string): Promise<void> {
  await Promise.all([refreshMe(), refreshCart(), refreshWishlist()]);
  navigate(next, { replace: true });
}

export function SignIn(_props: object) {
  const next = nextPath(useParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setFailure(null);
    try {
      await api.post("/api/session", { email, password });
      await afterSignIn(next);
    } catch (thrown) {
      if (thrown instanceof ApiFail && thrown.status === 422) setErrors(thrown.fields);
      else setFailure(thrown instanceof ApiFail ? thrown.message : "Something went wrong on our side. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page">
      <div className="axis">
        <div className="zone" />
        <div className="main auth-form">
          <h1>Sign in</h1>
          {failure && (
            <div role="alert" className="notice tone-red">
              {failure}
            </div>
          )}
          <form onSubmit={(event) => void submit(event)} noValidate>
            <TextField name="email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} error={errors.email} />
            <TextField name="password" label="Password" type="password" role="textbox" autoComplete="current-password" value={password} onChange={setPassword} error={errors.password} />
            <p>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                Sign in
              </button>
            </p>
          </form>
          <p>
            <Link href={next === "/" ? "/register" : `/register?next=${encodeURIComponent(next)}`} className="btn">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
