import { useEffect, useState, type FormEvent } from "react";
import { announce } from "../announce";
import { post } from "../api";
import { ActionButton, Band, TextField } from "../components/ui";
import { useAction } from "../hooks";
import { Link, navigate, useLocation } from "../router";
import { useSession } from "../session";
import { Screen } from "../shell/Page";
import type { SessionUser } from "../../shared/api";
import type { FieldErrors } from "../../shared/rules";

function useAuthForm() {
  const { busy, run } = useAction();
  const [fields, setFields] = useState<FieldErrors>({});
  const [failure, setFailure] = useState("");
  return { busy, run, fields, failure, setFields, setFailure };
}

export function SignIn() {
  const { query } = useLocation();
  const { refresh } = useSession();
  const form = useAuthForm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    form.setFailure("");
    form.setFields({});
    const result = await form.run(() => post<{ user: SessionUser }>("/api/auth/sign-in", { email, password }));
    if (result.ok) {
      await refresh();
      navigate(query.get("next") ?? "/");
    } else if (result.fields) {
      form.setFields(result.fields);
    } else {
      form.setFailure(result.message);
    }
  }

  return (
    <Screen title="Sign in" narrow band={form.failure ? <Band>{form.failure}</Band> : null}>
      <h1>Sign in</h1>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={form.fields["email"]} />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} error={form.fields["password"]} />
        <div className="row">
          <ActionButton type="submit" busy={form.busy}>Sign in</ActionButton>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <div style={{ marginTop: 16 }}>
          <Link to="/join">Create an account</Link>
        </div>
      </form>
    </Screen>
  );
}

export function Join() {
  const form = useAuthForm();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    form.setFailure("");
    form.setFields({});
    const result = await form.run(() => post("/api/auth/join", { display_name: name, email, password }));
    if (result.ok) {
      setSent(true);
      announce("Check your email to finish joining.");
    } else if (result.fields) {
      form.setFields(result.fields);
    } else {
      form.setFailure(result.message);
    }
  }

  return (
    <Screen title="Join" narrow band={form.failure ? <Band>{form.failure}</Band> : null}>
      <h1>Join Candour Bench</h1>
      {sent ? (
        <p>Check your email to finish joining.</p>
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <TextField label="Display name" autoComplete="nickname" value={name} onChange={(event) => setName(event.target.value)} error={form.fields["display_name"]} />
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={form.fields["email"]} />
          <TextField label="Password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} error={form.fields["password"]} hint="At least 10 characters." />
          <ActionButton type="submit" busy={form.busy}>Create account</ActionButton>
        </form>
      )}
    </Screen>
  );
}

export function JoinConfirm() {
  const { query } = useLocation();
  const { refresh } = useSession();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("");
  const token = query.get("token") ?? "";

  useEffect(() => {
    let current = true;
    void post<{ user: SessionUser }>("/api/auth/join/confirm", { token }).then(async (result) => {
      if (!current) return;
      if (result.ok) {
        await refresh();
        setState("done");
      } else {
        setMessage(result.message);
        setState("failed");
      }
    });
    return () => {
      current = false;
    };
  }, [token, refresh]);

  return (
    <Screen title="Welcome" narrow band={state === "failed" ? <Band>{message}</Band> : null}>
      {state === "done" ? (
        <>
          <h1>Welcome to Candour Bench</h1>
          <p>You are signed in. Share one review, pay report or interview note to unlock full pay and review detail.</p>
          <Link to="/contribute" className="btn">Share something</Link>
        </>
      ) : (
        <h1>{state === "working" ? "Finishing your sign-up" : "This link did not work"}</h1>
      )}
    </Screen>
  );
}

export function Forgot() {
  const form = useAuthForm();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    form.setFields({});
    const result = await form.run(() => post("/api/auth/forgot", { email }));
    if (result.ok) {
      setSent(true);
      announce("If that address has an account, a reset link is on its way.");
    } else if (result.fields) {
      form.setFields(result.fields);
    } else {
      form.setFailure(result.message);
    }
  }

  return (
    <Screen title="Forgot password" narrow band={form.failure ? <Band>{form.failure}</Band> : null}>
      <h1>Forgot password</h1>
      {sent ? (
        <p>If that address has an account, a reset link is on its way.</p>
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={form.fields["email"]} />
          <ActionButton type="submit" busy={form.busy}>Send reset link</ActionButton>
        </form>
      )}
    </Screen>
  );
}

export function Reset() {
  const { query } = useLocation();
  const { refresh } = useSession();
  const form = useAuthForm();
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    form.setFailure("");
    form.setFields({});
    const result = await form.run(() => post("/api/auth/reset", { token: query.get("token") ?? "", password }));
    if (result.ok) {
      await refresh();
      navigate("/");
      announce("Password changed. You are signed in.");
    } else if (result.fields) {
      form.setFields(result.fields);
    } else {
      form.setFailure(result.message);
    }
  }

  return (
    <Screen title="Reset password" narrow band={form.failure ? <Band>{form.failure}</Band> : null}>
      <h1>Reset password</h1>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <TextField label="New password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} error={form.fields["password"]} hint="At least 10 characters." />
        <ActionButton type="submit" busy={form.busy}>Change password</ActionButton>
      </form>
    </Screen>
  );
}
