// Staff sign-in. A wrong password and an unknown email get the same refusal; success lands on the member's home
// route, or back on the staff route the member was sent here from.
import { api } from "../api";
import { Heading, navigate } from "../router";
import { DeskStatus } from "../staff/desk";
import { Field, Problems, Refusal, submit, useForm } from "../ui/forms";
import type { SessionBody } from "../types";

const CONTROL = /[\u0000-\u001f\u007f\\]/;

/** A return address is accepted only as a same-origin path inside the member's own workspace (kit safe_redirect). */
function returnTo(next: string | null, slug: string): string | null {
  if (!next || next.length > 2048 || CONTROL.test(next) || !next.startsWith(`/w/${slug}/`)) return null;
  const url = new URL(next, location.origin);
  return url.origin === location.origin && url.pathname.startsWith(`/w/${slug}/`) ? url.pathname + url.search : null;
}

export function SignInPage() {
  const form = useForm({ email: "", password: "" });
  const onSubmit = (event: Event) => {
    event.preventDefault();
    void submit<SessionBody>(form, {
      action: "sign-in",
      pending: "Signing in…",
      call: () => api<SessionBody>("POST", "/api/session", { json: { email: form.values.email, password: form.values.password } }),
      done: (session) => {
        const next = returnTo(new URLSearchParams(location.search).get("next"), session.workspace.slug);
        navigate(next ?? session.home, { replace: true });
      },
    });
  };
  return (
    <main class="centered-page signin-page">
      <section class="centered-card signin-card">
        <a href="/" class="public-wordmark signin-wordmark" aria-label="Lanternline home">
          <svg class="wordmark-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
            <path d="M12 3.5v-2M12 22.5v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <span class="public-wordmark-text">Lanternline</span>
        </a>
        <Heading>Sign in to Lanternline</Heading>
        <p class="muted">The handshake desk for your exchange's compliance team.</p>
        <DeskStatus />
        <form class="form" noValidate onSubmit={onSubmit}>
          <Problems form={form} order={["email", "password"]} />
          <Refusal form={form} />
          <Field form={form} name="email" label="Email" type="email" autoComplete="username" />
          <Field form={form} name="password" label="Password" type="password" autoComplete="current-password" />
          <div class="form-actions">
            <button type="submit" class="button button-primary signin-submit" disabled={form.busy}>Sign in</button>
          </div>
        </form>
      </section>
    </main>
  );
}
