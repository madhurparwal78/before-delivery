import { useEffect, useState } from "react";
import { api, ApiFailure } from "./api.js";
import { copy } from "../shared/copy.js";
import { studioZones } from "../shared/zones.js";

export function AuthPage(props: { mode: "signup" | "check-inbox" | "signin" | "open" }): JSX.Element {
  if (props.mode === "signup") return <SignUp />;
  if (props.mode === "check-inbox") return <CheckInbox />;
  if (props.mode === "signin") return <SignIn />;
  return <OpenLink />;
}

function Frame(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "48px 20px", width: "100%" }}>
      <div className="word-mark" style={{ marginBottom: 24 }}>
        CORBEL<span>&nbsp;Works</span>
      </div>
      <h1 style={{ fontSize: 26, marginBottom: 18 }}>{props.title}</h1>
      {props.children}
      <div style={{ marginTop: 22, fontSize: 13.5, color: "#a7adb5" }}>
        <a href="/">Back to home</a>
      </div>
    </main>
  );
}

function SignUp(): JSX.Element {
  const [values, setValues] = useState({ name: "", email: "", password: "", time_zone: "UTC" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setAlert(null);
    try {
      await api("/api/auth/signup", { json: values });
      sessionStorage.setItem("corbel_signup_email", values.email);
      window.location.href = "/check-inbox";
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fields);
        if (err.code === "mail_unavailable") {
          sessionStorage.setItem("corbel_signup_email", values.email);
          window.location.href = "/check-inbox";
          return;
        }
        if (Object.keys(err.fields).length === 0) setAlert(err.code);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Frame title="Create account">
      <form aria-label="Create account" onSubmit={submit} noValidate>
        {alert && <div className="alert" role="alert">{alert}</div>}
        <div className="field">
          <label htmlFor="su-name">Name</label>
          <input
            id="su-name"
            aria-invalid={errors.name ? "true" : undefined}
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
            aria-describedby={errors.name ? "su-name-err" : undefined}
          />
          {errors.name && <div className="field-error" id="su-name-err">{errors.name}</div>}
        </div>
        <div className="field">
          <label htmlFor="su-email">Email</label>
          <input
            id="su-email"
            type="email"
            aria-invalid={errors.email ? "true" : undefined}
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            aria-describedby={errors.email ? "su-email-err" : undefined}
          />
          {errors.email && <div className="field-error" id="su-email-err">{errors.email}</div>}
        </div>
        <div className="field">
          <label htmlFor="su-password">Password</label>
          <input
            id="su-password"
            type="password"
            aria-invalid={errors.password ? "true" : undefined}
            value={values.password}
            onChange={(e) => setValues({ ...values, password: e.target.value })}
            aria-describedby={errors.password ? "su-password-err" : undefined}
          />
          {errors.password && <div className="field-error" id="su-password-err">{errors.password}</div>}
        </div>
        <div className="field">
          <label htmlFor="su-zone">Studio time zone</label>
          <select
            id="su-zone"
            value={values.time_zone}
            onChange={(e) => setValues({ ...values, time_zone: e.target.value })}
            aria-invalid={errors.time_zone ? "true" : undefined}
          >
            {studioZones.map((zone) => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>
          {errors.time_zone && <div className="field-error">{errors.time_zone}</div>}
        </div>
        <button className="btn btn-filled" type="submit" disabled={pending}>
          {pending ? copy.creatingAccount : "Create account"}
        </button>
      </form>
      <p style={{ marginTop: 18, fontSize: 14, color: "#a7adb5" }}>
        Already have an account? <a href="/signin">Sign in</a>
      </p>
    </Frame>
  );
}

function CheckInbox(): JSX.Element {
  const email = sessionStorage.getItem("corbel_signup_email") ?? "";
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const resend = async (): Promise<void> => {
    setPending(true);
    setNotice(null);
    setAlert(null);
    try {
      await api("/api/auth/verify/resend", { json: { email } });
      setNotice(copy.resendAccepted(email));
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "mail_unavailable") setAlert(copy.mailDown);
    } finally {
      setPending(false);
    }
  };
  return (
    <Frame title="Check your inbox">
      <p>We sent a confirmation link to {email}.</p>
      {notice && <div className="banner" style={{ margin: "14px 0" }}>{notice}</div>}
      {alert && <div className="alert" role="alert">{alert}</div>}
      <button className="btn btn-outline" type="button" onClick={resend} disabled={pending}>
        Send a new link
      </button>
    </Frame>
  );
}

function SignIn(): JSX.Element {
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setAlert(null);
    setUnconfirmed(null);
    try {
      await api("/api/auth/signin", { json: values });
      window.location.href = "/drawings";
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.code === "invalid_credentials") setAlert(copy.signInBad);
        else if (err.code === "unverified") {
          setUnconfirmed(String(err.extra.email ?? values.email));
          setAlert(copy.signInUnconfirmed(String(err.extra.email ?? values.email)));
        } else if (err.code === "signin_locked") {
          const seconds = Number(err.extra.retry_after_seconds ?? 60);
          setAlert(copy.signInLocked(Math.max(1, Math.ceil(seconds / 60))));
        }
      }
    } finally {
      setPending(false);
    }
  };

  const resend = async (): Promise<void> => {
    setPending(true);
    try {
      await api("/api/auth/verify/resend", { json: { email: unconfirmed ?? values.email } });
      setAlert(copy.resendAccepted(unconfirmed ?? values.email));
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "mail_unavailable") setAlert(copy.mailDown);
    } finally {
      setPending(false);
    }
  };

  return (
    <Frame title="Sign in">
      <form aria-label="Sign in" onSubmit={submit} noValidate>
        {alert && <div className="alert" role="alert" style={{ marginBottom: 14 }}>{alert}</div>}
        <div className="field">
          <label htmlFor="si-email">Email</label>
          <input id="si-email" type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="si-password">Password</label>
          <input id="si-password" type="password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
        </div>
        <button className="btn btn-filled" type="submit" disabled={pending}>
          {pending ? copy.signingIn : "Sign in"}
        </button>
      </form>
      {unconfirmed && (
        <p style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-outline" onClick={resend} disabled={pending}>
            Resend link
          </button>
        </p>
      )}
      <p style={{ marginTop: 18, fontSize: 14, color: "#a7adb5" }}>
        New here? <a href="/signup">Create account</a>
      </p>
    </Frame>
  );
}

function OpenLink(): JSX.Element {
  const [link, setLink] = useState("");
  return (
    <Frame title="Open a shared drawing">
      <form aria-label="Open a shared drawing" onSubmit={(e) => { e.preventDefault(); if (link.trim() !== "") window.location.href = link.trim(); }}>
        <div className="field">
          <label htmlFor="ol-link">Share link</label>
          <input id="ol-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        </div>
        <button className="btn btn-filled" type="submit">Open</button>
      </form>
    </Frame>
  );
}

export function VerifyPage(props: { token: string }): JSX.Element {
  const [state, setState] = useState<"loading" | "confirmed" | "expired" | "replaced" | "unknown" | "mail">("loading");
  useEffect(() => {
    const run = async (): Promise<void> => {
      try {
        await api("/api/auth/verify", { json: { token: props.token } });
        setState("confirmed");
      } catch (err) {
        if (err instanceof ApiFailure) {
          if (err.code === "verify_link_expired") setState("expired");
          else if (err.code === "verify_link_replaced") setState("replaced");
          else setState("unknown");
        }
      }
    };
    void run();
  }, [props.token]);
  const resend = async (): Promise<void> => {
    try {
      const email = window.location.hash.slice(1) || "";
      await api("/api/auth/verify/resend", { json: { token: props.token, email } });
      window.location.href = "/check-inbox";
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "mail_unavailable") setState("mail");
    }
  };
  return (
    <Frame title={state === "confirmed" ? copy.confirmed : state === "expired" ? copy.verifyExpired : state === "replaced" ? copy.verifyReplaced : state === "mail" ? copy.mailDown : copy.verifyUnknown}>
      {state === "confirmed" ? (
        <p>
          <a className="btn btn-filled" href="/signin">Sign in</a>
        </p>
      ) : state === "mail" ? (
        <div className="alert" role="alert">{copy.mailDown}</div>
      ) : (
        <button className="btn btn-outline" type="button" onClick={resend}>
          Send a new link
        </button>
      )}
    </Frame>
  );
}
