import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Logo, Status } from "./components.jsx";
import { api, ApiError, readToken, writeToken } from "./api.js";

function BackHome() {
  return <Link to="/" style={{ display: "inline-flex", minHeight: 44, alignItems: "center" }}>Wayline home</Link>;
}

export function SignInChooserPage() {
  return (
    <main className="signin-page">
      <div style={{ width: "100%", maxWidth: "440px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.4rem" }}>
          <span className="mk-logo" style={{ color: "#fff" }}><Logo /></span>
        </div>
        <h1 style={{ fontSize: "1.5rem", textAlign: "center", marginBottom: "0.5rem" }}>
          Sign in to your Wayline account
        </h1>
        <p style={{ textAlign: "center", marginBottom: "1.6rem" }}>
          Wayline runs in two planes. Choose where your workspace lives.
        </p>
        <div style={{ display: "grid", gap: "1rem" }}>
          <div className="signin-card">
            <h2>Wayline Cloud</h2>
            <p>Hosted console and pipeline, with usage-based credits.</p>
            <Link to="/login" className="btn btn-primary btn-block">Sign in to Wayline Cloud</Link>
          </div>
          <div className="signin-card">
            <h2>Wayline Self-hosted</h2>
            <p>Run the same console on your own servers or private cloud.</p>
            <Link to="/login" className="btn btn-outline btn-block"
              style={{ color: "#fff", borderColor: "#3a3f4d" }}>
              Sign in to a self-hosted Wayline
            </Link>
          </div>
        </div>
        <p style={{ textAlign: "center", marginTop: "1.4rem", fontSize: "0.86rem" }}>
          <BackHome />
        </p>
      </div>
    </main>
  );
}

export function LoginPage() {
  const params = new URLSearchParams(window.location.search);
  const nextParam = params.get("next") || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [alert, setAlert] = useState("");

  // a signed-in person opening /login lands on /app instead
  useEffect(() => {
    if (!readToken()) return undefined;
    api("/api/me").then(() => {
      window.location.replace("/app");
    }).catch(() => {});
    return undefined;
  }, []);

  const signIn = async (e) => {
    e.preventDefault();
    setPending(true);
    setMessage("Signing in…");
    setAlert("");
    try {
      const { data } = await api("/api/auth/login", {
        method: "POST",
        body: { email, password, next: nextParam },
        token: "",
      });
      writeToken(data.token);
      setMessage("");
      window.location.replace(data.redirect_to || "/app");
    } catch (error) {
      setPending(false);
      setMessage("");
      if (error instanceof ApiError) {
        if (error.status === 401) {
          setAlert("Email or password is incorrect.");
        } else if (error.status === 429) {
          const retry = Number(error.extra?.request_id ? 900 : 900);
          const headerSeconds = error.extra?.retry_after;
          setAlert(`Too many sign-in attempts. Try again in ${Math.ceil((headerSeconds || 900) / 60)} min.`);
        } else if (error.status === 503) {
          setAlert("Wayline can't reach its database right now. It keeps retrying on its own.");
        } else {
          setAlert("Wayline couldn't confirm this action. Check the list before trying again.");
        }
      } else {
        setAlert("Wayline couldn't confirm this action. Check the list before trying again.");
      }
    }
  };

  return (
    <main className="wrap narrow" style={{ maxWidth: "480px", padding: "3rem 1.25rem" }}>
      <h1 style={{ fontSize: "1.6rem" }}>Sign in</h1>
      <p style={{ color: "var(--muted)" }}>Open your workspace console.</p>
      {alert && <Alert tone="error">{alert}</Alert>}
      <form onSubmit={signIn} noValidate>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input id="login-email" className="input" type="text" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input id="login-password" className="input" type="password"
            autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <Status name="Sign-in status" message={message} id="sign-in-status" />
      <p style={{ marginTop: "1.4rem" }}><BackHome /></p>
    </main>
  );
}

export function AcceptInvitePage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [alert, setAlert] = useState("");
  const [fieldError, setFieldError] = useState("");

  const accept = async (e) => {
    e.preventDefault();
    setPending(true);
    setMessage("Accepting…");
    setAlert("");
    setFieldError("");
    try {
      const { data } = await api("/api/auth/accept-invite", {
        method: "POST",
        body: { invite_token: token, password },
        token: "",
      });
      writeToken(data.token);
      setMessage("");
      window.location.replace("/app");
    } catch (error) {
      setPending(false);
      setMessage("");
      if (error instanceof ApiError) {
        if (error.status === 400 && error.fields.password) {
          setFieldError(error.fields.password);
        } else if (error.status === 409 && error.code === "invite_used") {
          setAlert("This invitation has already been used.");
        } else if (error.status === 404) {
          setAlert("This invitation link is not valid.");
        } else if (error.status === 410) {
          setAlert("This invitation has expired. Ask an admin for a new one.");
        } else if (error.status === 503) {
          setAlert("Wayline can't reach its database right now. It keeps retrying on its own.");
        } else {
          setAlert("Wayline couldn't confirm this action. Check the list before trying again.");
        }
      } else {
        setAlert("Wayline couldn't confirm this action. Check the list before trying again.");
      }
    }
  };

  return (
    <main className="wrap narrow" style={{ maxWidth: "480px", padding: "3rem 1.25rem" }}>
      <h1 style={{ fontSize: "1.6rem" }}>Accept your invitation</h1>
      <p style={{ color: "var(--muted)" }}>Choose a password of at least twelve characters.</p>
      {alert && <Alert tone="error">{alert}</Alert>}
      <form onSubmit={accept} noValidate>
        <div className="field">
          <label htmlFor="accept-password">Password</label>
          <input id="accept-password" className="input" type="password"
            autoComplete="new-password" value={password}
            aria-describedby={fieldError ? "accept-password-error" : undefined}
            aria-invalid={Boolean(fieldError)}
            onChange={(e) => setPassword(e.target.value)} />
          {fieldError && <span className="field-error" id="accept-password-error">{fieldError}</span>}
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? "Accepting…" : "Accept invitation"}
        </button>
      </form>
      <Status name="Invitation status" message={message} id="invitation-status" />
      <p style={{ marginTop: "1.4rem" }}><BackHome /></p>
    </main>
  );
}
