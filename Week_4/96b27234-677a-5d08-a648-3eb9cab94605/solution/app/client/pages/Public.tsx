import { useEffect, useRef, useState, type FormEvent } from "react";
import { ZONES } from "../../shared/protocol";
import { call } from "../lib/api";
import { Link, navigate, safeNext, useLocation } from "../lib/router";
import { loadAccount } from "../lib/store";
import { useAction } from "../lib/useAction";
import { Lantern, MiniRoom } from "../ui/Drawings";
import { Status } from "../ui/Bits";
import { Icon } from "../ui/Icon";
import { Denied } from "./NotFound";

export function Home() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <Lantern size={88} />
        <h1 tabIndex={-1}>Hearthtile</h1>
        <p className="lede">
          A small gathering place for hobby communities. Walk tile by tile through paper-cut 3D rooms, talk only to the people nearby and meet at
          scheduled gatherings.
        </p>
        <div className="row">
          <Link to="/signup" className="button primary">
            Sign up
          </Link>
          <Link to="/signin" className="button">
            Sign in
          </Link>
        </div>
      </div>
      <MiniRoom />
    </section>
  );
}

export function SignIn() {
  const next = safeNext(new URLSearchParams(useLocation().split("?")[1] ?? "").get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const action = useAction("Signing in...");
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const reply = await action.run("POST", "/api/signin", { email, password }, () => "");
    if (reply.ok) {
      await loadAccount();
      navigate(next, true);
    }
  };
  return (
    <section className="panel narrow">
      <h1 tabIndex={-1}>Sign in</h1>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button type="submit" className="button primary" disabled={action.busy} aria-busy={action.busy}>
          Sign in
        </button>
        <Status name="Account result" result={action.result} />
      </form>
      <p className="hint">New here?</p>
      <Link to="/signup" className="button">
        Create an account
      </Link>
    </section>
  );
}

export function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [zone, setZone] = useState<string>(ZONES[0]);
  const action = useAction("Sending...");
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await action.run("POST", "/api/signup", { email, password, displayName: name, timeZone: zone }, () => "Check your email to confirm your account.");
  };
  return (
    <section className="panel narrow">
      <h1 tabIndex={-1}>Create your account</h1>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="field">
          <span>Display name</span>
          <input type="text" autoComplete="nickname" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Time zone</span>
          <select value={zone} onChange={(event) => setZone(event.target.value)}>
            {ZONES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button primary" disabled={action.busy} aria-busy={action.busy}>
          Create account
        </button>
        <Status name="Account result" result={action.result} />
      </form>
      <p className="hint">Already have an account?</p>
      <Link to="/signin" className="button">
        Sign in
      </Link>
    </section>
  );
}

export function Confirm({ token }: { token: string }) {
  const [state, setState] = useState<"working" | "done" | "dead">("working");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void call("POST", `/api/confirm/${encodeURIComponent(token)}`).then((reply) => setState(reply.ok ? "done" : "dead"));
  }, [token]);
  if (state === "dead") return <Denied heading="This link isn't available." />;
  return (
    <section className="panel narrow">
      <h1 tabIndex={-1}>{state === "done" ? "Your account is confirmed" : "Confirming your account"}</h1>
      {state === "done" ? (
        <p>
          <Link to="/signin" className="button primary">
            <Icon name="signout" size={18} /> Sign in
          </Link>
        </p>
      ) : null}
    </section>
  );
}
