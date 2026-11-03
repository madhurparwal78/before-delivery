import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { store } from "./store";
import { usePending } from "./ui";
import type { Me } from "./types";

function AuthCard({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <main className="page" style={{ maxWidth: 440, justifyContent: "center", minHeight: "100dvh" }}>
      <p style={{ textAlign: "center", fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, margin: 0 }}>
        Pratfall Cup
      </p>
      <section className="panel" style={{ padding: 24 }}>
        <h2 style={{ marginBottom: 16 }}>{title}</h2>
        {children}
      </section>
    </main>
  );
}

function FieldError({ id, text }: { id: string; text: string | null }): JSX.Element | null {
  if (!text) return null;
  return (
    <p className="field-error" id={id}>
      {text}
    </p>
  );
}

export function SignupPage({ onSignedIn }: { onSignedIn: () => void }): JSX.Element {
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = usePending();
  const [sent, setSent] = useState<"sent" | "failed" | null>(null);

  const submit = run(async () => {
    setErrors({});
    try {
      const result = await api.post<{ user: Me; verificationEmail: "sent" | "failed" }>("/api/auth/signup", {
        email,
        handle,
        password
      });
      store.me = result.user;
      store.notify(
        result.verificationEmail === "sent"
          ? `Account created. Check ${email} for your verification link.`
          : "Account created, but we couldn't send your verification email. Resend it once mail is back.",
        result.verificationEmail === "sent" ? "success" : "error"
      );
      setSent(result.verificationEmail);
      await store.signIn();
      onSignedIn();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.fields) {
          setErrors(e.fields);
          store.notify("Check the highlighted fields.", "error");
        } else {
          store.notify(e.message, "error");
        }
      }
    }
  });

  void sent;

  return (
    <AuthCard title="Create your account">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="su-email">Email</label>
          <input
            id="su-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={errors["email"] ? "su-email-err" : undefined}
          />
          <FieldError id="su-email-err" text={errors["email"] ?? null} />
        </div>
        <div className="field">
          <label htmlFor="su-handle">Handle</label>
          <input
            id="su-handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            aria-describedby={errors["handle"] ? "su-handle-err" : undefined}
          />
          <FieldError id="su-handle-err" text={errors["handle"] ?? null} />
        </div>
        <div className="field">
          <label htmlFor="su-password">Password</label>
          <input
            id="su-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={errors["password"] ? "su-password-err" : undefined}
          />
          <FieldError id="su-password-err" text={errors["password"] ?? null} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p style={{ marginTop: 14 }}>
        Already have an account?{" "}
        <a
          href="#/signin"
          onClick={(e) => {
            e.preventDefault();
            location.hash = "#/signin";
          }}
        >
          Sign in
        </a>
      </p>
    </AuthCard>
  );
}

export function SigninPage({ onSignedIn }: { onSignedIn: () => void }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, run] = usePending();

  const submit = run(async () => {
    try {
      await api.post("/api/auth/login", { email, password });
      await store.signIn();
      onSignedIn();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  return (
    <AuthCard title="Sign in">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="si-email">Email</label>
          <input id="si-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="si-password">Password</label>
          <input
            id="si-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p style={{ marginTop: 14 }}>
        <a
          href="#/forgot-password"
          onClick={(e) => {
            e.preventDefault();
            location.hash = "#/forgot-password";
          }}
        >
          Forgot password?
        </a>
      </p>
      <p>
        No account yet?{" "}
        <a
          href="#/signup"
          onClick={(e) => {
            e.preventDefault();
            location.hash = "#/signup";
          }}
        >
          Create one
        </a>
      </p>
    </AuthCard>
  );
}

export function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [busy, run] = usePending();

  const submit = run(async () => {
    try {
      await api.post("/api/auth/password-reset", { email });
      store.notify("If that email has an account, a reset link is on its way.", "success");
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  return (
    <AuthCard title="Reset your password">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="fp-email">Email</label>
          <input id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordPage({ token }: { token: string }): JSX.Element {
  const [password, setPassword] = useState("");
  const [busy, run] = usePending();

  const submit = run(async () => {
    try {
      await api.post("/api/auth/password-reset/confirm", { token, password });
      store.notify("Password changed. Sign in with your new password.", "success");
      location.hash = "#/signin";
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  return (
    <AuthCard title="Choose a new password">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="rp-password">New password</label>
          <input
            id="rp-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? "Saving…" : "Set new password"}
        </button>
      </form>
    </AuthCard>
  );
}

export function VerifyPage({ token }: { token: string }): JSX.Element {
  const [state, setState] = useState<"checking" | "ok" | "error">("checking");
  const [message, setMessage] = useState("Checking your link…");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.post<{ user: Me }>("/api/auth/verify", { token });
        if (cancelled) return;
        store.me = result.user;
        setState("ok");
        setMessage("Email verified. You can add friends and play.");
        await store.signIn();
      } catch (e) {
        if (cancelled) return;
        setState("error");
        setMessage(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthCard title="Verification">
      <div>
        <p role="region" aria-label="Verification" data-state={state}>
          {message}
        </p>
        {state === "ok" && (
          <p>
            <a
              href="#/"
              onClick={(e) => {
                e.preventDefault();
                location.hash = "#/";
              }}
            >
              Go to the app
            </a>
          </p>
        )}
      </div>
    </AuthCard>
  );
}
