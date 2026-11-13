import { useState } from "preact/hooks";
import { type User, post } from "../api";
import { Link, useAction, useBand, useDesk } from "../desk";
import { type FieldErrors, Submit, TextField, focusFirstError } from "../form";

// Sign in and Create a studio account (brief: Public screens and controls).

const HOME: Record<User["role"], string> = { studio: "/studio", juror: "/jury", director: "/director" };

/** Only a same-origin path is ever followed after sign-in. */
function nextPath(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/signin") ? next : null;
}

export function SignIn() {
  useBand({ name: "Cutline Jury Desk", target: null });
  const desk = useDesk();
  const run = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const result = await run("Signing in…", () => post<{ user: User }>("/api/session", { email, password }));
    setBusy(false);
    if (!result.ok) return;
    desk.setUser(result.data.user);
    desk.navigate(nextPath(location.search) ?? HOME[result.data.user.role], true);
  };
  return (
    <div class="page page--form">
      <form class="form-card" onSubmit={submit} noValidate>
        <h1 class="page-title">Sign in</h1>
        <TextField id="signin-email" label="Email" type="email" autoComplete="email" value={email} onValue={setEmail} />
        <TextField id="signin-password" label="Password" type="password" autoComplete="current-password" value={password} onValue={setPassword} />
        <div class="actions">
          <Submit busy={busy} label="Sign in" pending="Signing in…" />
          <Link href="/signup" class="text-link">Create a studio account</Link>
        </div>
      </form>
    </div>
  );
}

export function SignUp() {
  useBand({ name: "Cutline Jury Desk", target: null });
  const desk = useDesk();
  const run = useAction();
  const [form, setForm] = useState({ studioName: "", contactName: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const field = (name: keyof typeof form) => (value: string) => setForm({ ...form, [name]: value });
  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const result = await run("Creating your studio…", () => post<{ user: User }>("/api/studios", form), () => "Studio account created.");
    setBusy(false);
    setErrors(result.ok ? {} : result.fields);
    if (!result.ok) {
      focusFirstError([["studioName", "signup-studio"], ["contactName", "signup-contact"], ["email", "signup-email"],
        ["password", "signup-password"]], result.fields);
      return;
    }
    desk.setUser(result.data.user);
    desk.navigate("/studio", true);
  };
  return (
    <div class="page page--form">
      <form class="form-card" onSubmit={submit} noValidate>
        <h1 class="page-title">Create a studio account</h1>
        <TextField id="signup-studio" label="Studio name" value={form.studioName} onValue={field("studioName")} error={errors.studioName}
          autoComplete="organization" />
        <TextField id="signup-contact" label="Contact name" value={form.contactName} onValue={field("contactName")} error={errors.contactName}
          autoComplete="name" />
        <TextField id="signup-email" label="Email" type="email" value={form.email} onValue={field("email")} error={errors.email}
          autoComplete="email" />
        <TextField id="signup-password" label="Password" type="password" value={form.password} onValue={field("password")}
          error={errors.password} autoComplete="new-password" hint="At least 10 characters." />
        <div class="actions">
          <Submit busy={busy} label="Create studio account" pending="Creating your studio…" />
          <Link href="/signin" class="text-link">I already have an account</Link>
        </div>
      </form>
    </div>
  );
}
