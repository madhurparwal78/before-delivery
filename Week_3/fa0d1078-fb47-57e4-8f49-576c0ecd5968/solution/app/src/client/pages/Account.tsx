import type { JSX } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import type { Player } from "../../shared/protocol";
import { ApiFailure, post } from "../api";
import { announce } from "../announcer";
import { ErrorSummary, Field, FormTile, type FieldErrors } from "../components/Form";
import { useLoad } from "../hooks";
import { failureSentence, M56 } from "../messages";
import { loadMe, setMe } from "../me";
import { navigate, useLocation } from "../router";
import { safeRedirect } from "../safeRedirect";

interface FormState {
  pending: boolean;
  errors: FieldErrors;
  note: string | null;
}

const idle: FormState = { pending: false, errors: {}, note: null };

/** Runs one form submission: pending sentence, then the answer, field errors or the failure sentence. */
function useSubmit(pendingSentence: string | null): {
  form: FormState;
  submit: (send: () => Promise<void>, onError?: (error: ApiFailure) => string | null) => void;
} {
  const [form, setForm] = useState<FormState>(idle);
  const submit = (send: () => Promise<void>, onError?: (error: ApiFailure) => string | null): void => {
    if (form.pending) return;
    setForm({ pending: true, errors: {}, note: null });
    if (pendingSentence) announce(pendingSentence);
    send().then(
      () => setForm((current) => ({ ...current, pending: false })),
      (error: unknown) => {
        const failure = error instanceof ApiFailure ? error : new ApiFailure(0, "NETWORK");
        if (failure.code === "VALIDATION") {
          setForm({ pending: false, errors: failure.fields, note: null });
          return;
        }
        const note = onError?.(failure) ?? failureSentence(failure);
        setForm({ pending: false, errors: {}, note });
        announce(note);
      },
    );
  };
  return { form, submit };
}

function SubmitButton({ pending, children }: { pending: boolean; children: string }): JSX.Element {
  return (
    <button type="submit" class="button" aria-disabled={pending ? "true" : "false"}>
      {children}
    </button>
  );
}

export function SignIn(): JSX.Element {
  const { search } = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { form, submit } = useSubmit("Signing you in.");
  return (
    <FormTile title="Sign in">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(
            async () => {
              const { player } = await post<{ player: Player }>("/api/auth/signin", { email, password });
              setMe(player);
              navigate(safeRedirect(search.get("next")));
            },
            (error) => (error.code === "BAD_CREDENTIALS" ? "Email or password is incorrect." : null),
          );
        }}
      >
        <ErrorSummary errors={form.errors} />
        <Field name="email" label="Email" type="email" autocomplete="email" value={email} error={form.errors.email} onInput={setEmail} />
        <Field name="password" label="Password" type="password" autocomplete="current-password" value={password} error={form.errors.password} onInput={setPassword} />
        <SubmitButton pending={form.pending}>Sign in</SubmitButton>
        {form.note && <p class="form-note">{form.note}</p>}
      </form>
    </FormTile>
  );
}

export function SignUp(): JSX.Element {
  const { search } = useLocation();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [notSent, setNotSent] = useState(false);
  const { form, submit } = useSubmit("Creating your account.");
  return (
    <FormTile title="Create your account">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(async () => {
            const created = await post<{ player: Player; verification_sent: boolean }>("/api/auth/signup", {
              email,
              display_name: displayName,
              password,
            });
            setMe(created.player);
            if (created.verification_sent) navigate(safeRedirect(search.get("next")));
            else {
              setNotSent(true);
              announce("Your account is ready, but we couldn't send the confirmation email. Use Send again in a minute.");
            }
          });
        }}
      >
        <ErrorSummary errors={form.errors} />
        <Field name="email" label="Email" type="email" autocomplete="email" value={email} error={form.errors.email} onInput={setEmail} />
        <Field name="display_name" label="Display name" type="text" autocomplete="nickname" value={displayName} error={form.errors.display_name} onInput={setDisplayName} />
        <Field name="password" label="Password" type="password" autocomplete="new-password" value={password} error={form.errors.password} onInput={setPassword} />
        <SubmitButton pending={form.pending}>Create account</SubmitButton>
        {form.note && <p class="form-note">{form.note}</p>}
        {notSent && <p class="form-note">Your account is ready, but we couldn't send the confirmation email. Use Send again in a minute.</p>}
      </form>
    </FormTile>
  );
}

export function ResetRequest(): JSX.Element {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { form, submit } = useSubmit("Sending the reset link.");
  return (
    <FormTile title="Reset your password">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(
            async () => {
              await post("/api/auth/reset", { email });
              setSent(true);
              announce("If that email has an account, a reset link is on its way.");
            },
            (error) => (error.code === "MAIL_UNAVAILABLE" ? "We couldn't send email right now. Try again in a minute." : null),
          );
        }}
      >
        <ErrorSummary errors={form.errors} />
        <Field name="email" label="Email" type="email" autocomplete="email" value={email} error={form.errors.email} onInput={setEmail} />
        <SubmitButton pending={form.pending}>Send reset link</SubmitButton>
        {form.note && <p class="form-note">{form.note}</p>}
        {sent && <p class="form-note">If that email has an account, a reset link is on its way.</p>}
      </form>
    </FormTile>
  );
}

const RESET_LINK: Record<string, string> = {
  TOKEN_USED: "This reset link was already used.",
  TOKEN_EXPIRED: "This reset link has expired.",
  TOKEN_NOT_FOUND: "This reset link isn't valid.",
};

export function ResetConfirm({ token }: { token: string }): JSX.Element {
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { form, submit } = useSubmit(null);
  return (
    <FormTile title="Choose a new password">
      {saved ? (
        <p class="voice-line">Your password is saved.</p>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit(async () => {
              try {
                const { player } = await post<{ player: Player }>("/api/auth/reset/confirm", { token, password });
                setMe(player);
                setSaved(true);
                announce("Your password is saved.");
              } catch (error) {
                const sentence = error instanceof ApiFailure ? RESET_LINK[error.code] : undefined;
                if (!sentence) throw error;
                setRefusal(sentence);
                announce(sentence);
              }
            });
          }}
        >
          <ErrorSummary errors={form.errors} />
          <Field name="password" label="New password" type="password" autocomplete="new-password" value={password} error={form.errors.password} onInput={setPassword} />
          <SubmitButton pending={form.pending}>Save password</SubmitButton>
          {refusal && <p class="form-note">{refusal}</p>}
          {form.note && <p class="form-note">{form.note}</p>}
        </form>
      )}
    </FormTile>
  );
}

const CONFIRM_LINK: Record<string, string> = {
  TOKEN_USED: "This confirmation link was already used.",
  TOKEN_EXPIRED: "This confirmation link has expired.",
  TOKEN_NOT_FOUND: "This confirmation link isn't valid.",
};

/** Opens a confirmation link once; a second mount for the same token reuses the first answer. */
const opened = new Map<string, Promise<void>>();

export function Verify({ token }: { token: string }): JSX.Element {
  const loaded = useLoad(async () => {
    const first = opened.get(token) ?? post("/api/auth/verify", { token }).then(() => undefined);
    opened.set(token, first);
    await first;
    await loadMe().catch(() => undefined);
  }, token);
  const sentence =
    loaded.status === "ready"
      ? "Your email is confirmed."
      : loaded.status === "failed"
        ? (CONFIRM_LINK[loaded.error.code] ?? (loaded.error.code === "STORAGE_UNAVAILABLE" ? failureSentence(loaded.error) : M56))
        : "The atelier is preparing your page.";
  useLayoutEffect(() => {
    if (loaded.status !== "loading") announce(sentence);
  }, [loaded.status]);
  return (
    <FormTile title="Confirm your email">
      <p class="voice-line">{sentence}</p>
    </FormTile>
  );
}
