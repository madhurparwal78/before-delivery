import { useLayoutEffect, useState } from "preact/hooks";
import { api, ApiFailure } from "../api.ts";
import { FormFeedback, TextField, useForm } from "../components/forms.tsx";
import { loadMe } from "../me.ts";
import { Link, navigate, useLocation } from "../router.tsx";
import { Loading, NotFound } from "./shared.tsx";

export function SignInForm() {
  const form = useForm();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Signing in...");
    try {
      await api("POST", "/api/session", { email, password });
      await loadMe();
      const next = new URLSearchParams(location.search).get("next");
      navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (error) {
      form.fail(error);
    }
  };
  return (
    <form class="form" onSubmit={(event) => void submit(event)}>
      <TextField name="email" label="Email" value={email} onInput={setEmail} type="email" autoComplete="username" />
      <TextField name="password" label="Password" value={password} onInput={setPassword} type="password" autoComplete="current-password" />
      <button type="submit">Sign in</button>
      <FormFeedback form={form} />
    </form>
  );
}

export function SignInPage() {
  return (
    <div class="cell page-cell narrow">
      <h1>Sign in</h1>
      <SignInForm />
      <p>
        New here? <Link href="/signup">Create an account</Link>
      </p>
    </div>
  );
}

export function SignUpPage() {
  const form = useForm();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Saving...");
    try {
      await api("POST", "/api/signup", { name, email, password });
      form.succeed("Check your email to verify your account.");
    } catch (error) {
      form.fail(error);
    }
  };
  const errors = form.state.errors;
  return (
    <div class="cell page-cell narrow">
      <h1>Create your account</h1>
      <form class="form" onSubmit={(event) => void submit(event)}>
        <TextField name="name" label="Name" value={name} onInput={setName} error={errors.name} autoComplete="name" />
        <TextField name="email" label="Email" value={email} onInput={setEmail} error={errors.email} type="email" autoComplete="email" />
        <TextField name="password" label="Password" value={password} onInput={setPassword} error={errors.password} type="password" autoComplete="new-password" />
        <button type="submit">Create account</button>
        <FormFeedback form={form} fields={{ name: "Name", email: "Email", password: "Password" }} />
      </form>
      <p>
        Already registered? <Link href="/signin">Sign in</Link>
      </p>
    </div>
  );
}

export function VerifyPage() {
  const { search } = useLocation();
  const token = new URLSearchParams(search).get("token") ?? "";
  const [outcome, setOutcome] = useState<"checking" | "verified" | "expired" | "missing">("checking");
  useLayoutEffect(() => {
    api("POST", "/api/verify", { token })
      .then(() => setOutcome("verified"))
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setOutcome(error.status === 410 ? "expired" : "missing");
      });
  }, [token]);
  if (outcome === "checking") return <Loading />;
  if (outcome === "missing") return <NotFound />;
  if (outcome === "expired") {
    return (
      <div class="cell page-cell narrow">
        <h1>This verification link has expired.</h1>
        <p>
          <Link href="/signup">Sign up again</Link> to receive a new link.
        </p>
      </div>
    );
  }
  return (
    <div class="cell page-cell narrow">
      <h1>Email verified.</h1>
      <p>
        <Link href="/signin">Continue to sign in</Link>
      </p>
    </div>
  );
}

export function InvitePage({ token }: { token: string }) {
  const form = useForm();
  const [invite, setInvite] = useState<{ class: string; email: string } | "loading" | { refused: string } | "missing">("loading");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  useLayoutEffect(() => {
    api<{ class: string; email: string }>("GET", `/api/invitations/${token}`)
      .then(setInvite)
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setInvite(error.status === 410 ? { refused: error.message } : "missing");
      });
  }, [token]);
  if (invite === "loading") return <Loading />;
  if (invite === "missing") return <NotFound />;
  if ("refused" in invite) {
    return (
      <div class="cell page-cell narrow">
        <h1>Invitation</h1>
        <p>{invite.refused}</p>
      </div>
    );
  }
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Joining...");
    try {
      const answer = await api<{ classId: string }>("POST", `/api/invitations/${token}/accept`, { name, password });
      await loadMe();
      navigate(`/classes/${answer.classId}`);
    } catch (error) {
      form.fail(error);
    }
  };
  const errors = form.state.errors;
  return (
    <div class="cell page-cell narrow">
      <h1>Join {invite.class}</h1>
      <p class="muted">Invited as {invite.email}</p>
      <form class="form" onSubmit={(event) => void submit(event)}>
        <TextField name="name" label="Name" value={name} onInput={setName} error={errors.name} autoComplete="name" />
        <TextField name="password" label="Password" value={password} onInput={setPassword} error={errors.password} type="password" autoComplete="new-password" />
        <button type="submit">Join class</button>
        <FormFeedback form={form} fields={{ name: "Name", password: "Password" }} />
      </form>
    </div>
  );
}
