import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Member, Workspace } from "../../shared/types.js";
import { dayLabel, wallOf } from "../../shared/time.js";
import { api, ApiFailure, SERVER_ERROR } from "../api.js";
import { announce } from "../announce.js";
import type { Navigate } from "../App.js";
import { browserZone, Field, ZoneSelect } from "../components/Field.js";

function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="entry">
      <p className="entry-brand">Tidemark Daybook</p>
      <div className="entry-sheet">{children}</div>
    </div>
  );
}

export function SignIn({ onSignedIn, navigate }: { onSignedIn: (operator: boolean) => void; navigate: Navigate }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api<{ member: Member }>("POST", "/api/auth/sign-in", { body: { email, password } });
      onSignedIn(result.member.role === "operator");
    } catch (failure) {
      const copy = failure instanceof ApiFailure && failure.status === 401 ? "That email and password don't match." : SERVER_ERROR;
      setError(copy);
      announce(copy);
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet>
      <h1 className="entry-title">Sign in</h1>
      <form aria-label="Sign in" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <Field label="Password" type="password" autoComplete="current-password" value={password} error={error ?? undefined} onChange={(e) => setPassword(e.currentTarget.value)} />
        <button type="submit" className="button button-primary button-wide" aria-busy={pending} disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="entry-alt">
        New here?{" "}
        <a
          href="/start"
          onClick={(event) => {
            event.preventDefault();
            navigate("/start");
          }}
        >
          Start a free trial
        </a>
      </p>
    </Sheet>
  );
}

type TrialFields = { workspaceName: string; ownerName: string; email: string; password: string; timeZone: string };

export function StartTrial({ onCreated, navigate }: { onCreated: () => void; navigate: Navigate }) {
  const [form, setForm] = useState<TrialFields>({ workspaceName: "", ownerName: "", email: "", password: "", timeZone: browserZone() });
  const [errors, setErrors] = useState<Partial<Record<keyof TrialFields, string>>>({});
  const [pending, setPending] = useState(false);
  const set = (key: keyof TrialFields) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Partial<Record<keyof TrialFields, string>> = {};
    if (!form.workspaceName.trim()) local.workspaceName = "Enter a workspace name.";
    if (!form.ownerName.trim()) local.ownerName = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) local.email = "Enter a valid email address.";
    if (form.password.length < 10) local.password = "Use at least 10 characters.";
    setErrors(local);
    if (Object.keys(local).length) {
      announce("Some fields need attention.");
      return;
    }
    setPending(true);
    try {
      const result = await api<{ workspace: Workspace; member: Member; billing: "registered" | "queued" }>("POST", "/api/workspaces", { body: form });
      const end = dayLabel(wallOf(Date.parse(result.workspace.trialEndsAt), result.member.timeZone).date);
      announce(
        result.billing === "registered"
          ? `Workspace created. Your trial ends on ${end}.`
          : "Workspace created. Billing is unreachable, so your seat will be registered when it's back.",
      );
      onCreated();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "email_taken") {
        setErrors({ email: "That email already has a Daybook." });
        announce("That email already has a Daybook.");
      } else if (failure instanceof ApiFailure && failure.status === 422) {
        setErrors(failure.fields);
        announce("Some fields need attention.");
      } else announce(SERVER_ERROR);
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet>
      <h1 className="entry-title">Start your trial</h1>
      <p className="entry-lede">Fourteen days to plan your weeks against your own Waterline. No card needed.</p>
      <form aria-label="Start your trial" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Workspace name" value={form.workspaceName} maxLength={80} error={errors.workspaceName} onChange={(e) => set("workspaceName")(e.currentTarget.value)} />
        <Field label="Your name" autoComplete="name" value={form.ownerName} maxLength={80} error={errors.ownerName} onChange={(e) => set("ownerName")(e.currentTarget.value)} />
        <Field label="Email" type="email" autoComplete="email" value={form.email} error={errors.email} onChange={(e) => set("email")(e.currentTarget.value)} />
        <Field label="Password" type="password" autoComplete="new-password" value={form.password} error={errors.password} hint="At least 10 characters." onChange={(e) => set("password")(e.currentTarget.value)} />
        <ZoneSelect value={form.timeZone} error={errors.timeZone} onChange={set("timeZone")} />
        <button type="submit" className="button button-primary button-wide" aria-busy={pending} disabled={pending}>
          {pending ? "Creating workspace…" : "Start free trial"}
        </button>
      </form>
      <p className="entry-alt">
        Already planning?{" "}
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("/");
          }}
        >
          Sign in
        </a>
      </p>
    </Sheet>
  );
}

export function Join({ token, onJoined }: { token: string; onJoined: () => void }) {
  const [invite, setInvite] = useState<{ workspaceName: string; email: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", password: "", timeZone: browserZone() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<{ workspaceName: string; email: string }>("GET", `/api/invitations/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((failure: unknown) => {
        setProblem(
          failure instanceof ApiFailure && failure.status === 410
            ? "This invite has already been used."
            : failure instanceof ApiFailure && failure.status === 404
              ? "That invite link isn't valid. Ask the workspace owner for a new one."
              : SERVER_ERROR,
        );
      });
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!form.name.trim()) local.name = "Enter your name.";
    if (form.password.length < 10) local.password = "Use at least 10 characters.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setPending(true);
    try {
      await api("POST", `/api/invitations/${encodeURIComponent(token)}/accept`, { body: form });
      onJoined();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 410) {
        setProblem("This invite has already been used.");
        announce("This invite has already been used.");
      } else if (failure instanceof ApiFailure && failure.status === 422) setErrors(failure.fields);
      else announce(SERVER_ERROR);
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet>
      {problem ? (
        <>
          <h1 className="entry-title">Join a workspace</h1>
          <p className="entry-problem">{problem}</p>
        </>
      ) : invite ? (
        <>
          <h1 className="entry-title">Join {invite.workspaceName}</h1>
          <p className="entry-lede">
            You're joining as <strong>{invite.email}</strong>.
          </p>
          <form aria-label={`Join ${invite.workspaceName}`} onSubmit={(event) => void submit(event)} noValidate>
            <Field label="Your name" autoComplete="name" value={form.name} maxLength={80} error={errors.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
            <Field label="Password" type="password" autoComplete="new-password" value={form.password} error={errors.password} hint="At least 10 characters." onChange={(e) => setForm({ ...form, password: e.currentTarget.value })} />
            <ZoneSelect value={form.timeZone} error={errors.timeZone} onChange={(timeZone) => setForm({ ...form, timeZone })} />
            <button type="submit" className="button button-primary button-wide" aria-busy={pending} disabled={pending}>
              {pending ? "Joining…" : "Join workspace"}
            </button>
          </form>
        </>
      ) : (
        <p className="muted" aria-busy="true">
          Opening your invite…
        </p>
      )}
    </Sheet>
  );
}
