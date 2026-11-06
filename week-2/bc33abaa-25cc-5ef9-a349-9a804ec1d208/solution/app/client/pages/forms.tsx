// Account forms: start trial, sign in and join a workspace. Loaded only when one of them opens.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ApiError, get, post } from "../api.js";
import { Button, Field, Link, Status, navigate, useBusy } from "../ui.js";
import { PublicLayout } from "./public.js";

const ZONES: string[] = (() => {
  const supported = Intl.supportedValuesOf("timeZone");
  return supported.includes("UTC") ? supported : ["UTC", ...supported];
})();

function FormPage({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <PublicLayout>
      <div class="form-page">
        <div class="panel form-card">
          <div class="panel-title"><h1 style={{ fontSize: "var(--h2)" }}>{title}</h1></div>
          <div class="panel-body">{children}</div>
        </div>
      </div>
    </PublicLayout>
  );
}

const EMAIL_TAKEN = "That email already has a workspace. Sign in instead.";

export function Signup() {
  const [values, setValues] = useState({ workspaceName: "", name: "", email: "", password: "", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, run] = useBusy();
  const set = (key: keyof typeof values) => (event: Event) => setValues({ ...values, [key]: (event.currentTarget as HTMLInputElement).value });
  const submit = (event: Event) => {
    event.preventDefault();
    setStatus("Creating your workspace…");
    setErrors({});
    void run(async () => {
      try {
        await post("/api/signup", values);
        navigate("/app");
      } catch (error) {
        if (error instanceof ApiError && error.code === "email_taken") { setStatus(""); setErrors({ email: EMAIL_TAKEN }); return; }
        if (error instanceof ApiError) { setStatus(""); setErrors(error.fieldErrors); return; }
        setStatus("Something went wrong. Try again.");
      }
    });
  };
  return (
    <FormPage title="Start your trial">
      <form aria-label="Start your trial" onSubmit={submit} noValidate>
        <Field label="Workspace name" value={values.workspaceName} onInput={set("workspaceName")} error={errors.workspaceName} autocomplete="organization" />
        <Field label="Your name" value={values.name} onInput={set("name")} error={errors.name} autocomplete="name" />
        <Field label="Work email" type="email" value={values.email} onInput={set("email")} error={errors.email} autocomplete="email" />
        {errors.email === EMAIL_TAKEN ? <p><Link href="/login">Sign in instead</Link></p> : null}
        <Field label="Password" type="password" value={values.password} onInput={set("password")} error={errors.password} autocomplete="new-password" />
        <div class="field">
          <label for="signup-zone">Time zone</label>
          <select id="signup-zone" value={values.timeZone} onChange={set("timeZone")}>
            {ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          {errors.timeZone ? <span class="field-error">{errors.timeZone}</span> : null}
        </div>
        <Button type="submit" variant="primary" busy={busy}>Start 14-day trial</Button>
        <Status label="Form status" text={status} />
      </form>
    </FormPage>
  );
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, run] = useBusy();
  const submit = (event: Event) => {
    event.preventDefault();
    setStatus("Signing in…");
    void run(async () => {
      try {
        await post("/api/auth/login", { email, password });
        navigate("/app");
      } catch {
        setStatus("Email or password is incorrect.");
      }
    });
  };
  return (
    <FormPage title="Sign in">
      <form aria-label="Sign in" onSubmit={submit} noValidate>
        <Field label="Email" type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} autocomplete="email" />
        <Field label="Password" type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="current-password" />
        <Button type="submit" variant="primary" busy={busy}>Sign in</Button>
        <Status label="Form status" text={status} />
        <p class="muted small">New to Orrery Studio? <Link href="/signup">Start free trial</Link></p>
      </form>
    </FormPage>
  );
}

export function Invite({ token }: { token: string }) {
  const [invite, setInvite] = useState<{ workspace: { name: string }; email: string; role: string } | null | "invalid">(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, run] = useBusy();
  useEffect(() => {
    get<{ workspace: { name: string }; email: string; role: string }>(`/api/invites/${encodeURIComponent(token)}`)
      .then(setInvite, () => setInvite("invalid"));
  }, [token]);
  if (invite === "invalid") return <FormPage title="Join workspace"><p>This invitation is no longer valid.</p></FormPage>;
  if (!invite) return <FormPage title="Join workspace"><p class="muted">Loading invitation…</p></FormPage>;
  const submit = (event: Event) => {
    event.preventDefault();
    setStatus("Signing in…");
    setErrors({});
    void run(async () => {
      try {
        await post(`/api/invites/${encodeURIComponent(token)}/accept`, { name, password });
        navigate("/app");
      } catch (error) {
        setStatus("");
        if (error instanceof ApiError && error.code === "email_taken") setStatus(EMAIL_TAKEN);
        else if (error instanceof ApiError && error.status === 404) setInvite("invalid");
        else if (error instanceof ApiError) setErrors(error.fieldErrors);
      }
    });
  };
  return (
    <FormPage title={`Join ${invite.workspace.name}`}>
      <p class="muted">You were invited as {invite.role.replace("_", " ")} with {invite.email}.</p>
      <form aria-label="Join workspace" onSubmit={submit} noValidate>
        <Field label="Your name" value={name} onInput={(e) => setName(e.currentTarget.value)} error={errors.name} autocomplete="name" />
        <Field label="Password" type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} error={errors.password} autocomplete="new-password" />
        <Button type="submit" variant="primary" busy={busy}>{`Join ${invite.workspace.name}`}</Button>
        <Status label="Form status" text={status} />
      </form>
    </FormPage>
  );
}
