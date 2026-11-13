import { useRef, useState } from "preact/hooks";
import type { Account } from "../../shared/api.ts";
import { request } from "../api.ts";
import { useAnnouncer } from "../announce.ts";
import { connectLive } from "../live.ts";
import { navigate, useLocation } from "../router.ts";
import { refreshGameweek, refreshNotices, setState } from "../store.ts";

// Sign in and Create account (brief: Screens / Sign in; Feedback states).
const OUTAGE = "Sign-in is unavailable right now. Try again in a minute.";
const FIELD_IDS: Record<string, string> = { email: "field-email", password: "field-password", team_name: "field-team" };

export function SignInPage() {
  const { search } = useLocation();
  const creating = search.get("mode") === "create";
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announcement, announce] = useAnnouncer();
  const form = useRef<HTMLFormElement>(null);

  const switchMode = (event: MouseEvent, create: boolean) => {
    event.preventDefault();
    setErrors({});
    navigate(create ? "/signin?mode=create" : "/signin", true);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    const data = new FormData(form.current!);
    const body: Record<string, string> = { email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") };
    if (creating) body.team_name = String(data.get("team_name") ?? "");
    setPending(true);
    const result = await request<Account>("POST", creating ? "/api/auth/signup" : "/api/auth/signin", body);
    setPending(false);
    if (result.ok) {
      setErrors({});
      const destination =
        result.data.role === "operator" ? "/operator" : creating || !(await request("GET", "/api/squad")).ok ? "/transfers" : "/team";
      navigate(destination);
      setState({ me: result.data });
      connectLive();
      void refreshGameweek();
      void refreshNotices();
      return;
    }
    const { error } = result;
    if (result.status === 422 && error.fields) {
      setErrors(error.fields);
      announce("Check the fields below.", true);
    } else {
      setErrors({});
      const copy: Record<string, string> = {
        bad_credentials: "Email or password is wrong.",
        accounts_unavailable: OUTAGE,
        email_taken: "An account with this email already exists.",
      };
      announce(copy[error.error] ?? error.message, true);
    }
  };

  const inputProps = (id: string, name: string, autocomplete: string, message: string | undefined) => ({
    id,
    name,
    class: "input",
    autocomplete,
    required: true,
    "aria-invalid": message ? ("true" as const) : undefined,
    "aria-describedby": message ? `${id}-error` : undefined,
  });

  const field = (name: string, label: string, type: "email" | "password" | "text", autocomplete: string) => {
    const id = FIELD_IDS[name]!;
    const message = errors[name];
    return (
      <div class="field">
        <label for={id}>{label}</label>
        {type === "password" ? <input type="password" {...inputProps(id, name, autocomplete, message)} /> : type === "email" ? <input type="email" {...inputProps(id, name, autocomplete, message)} /> : <input type="text" {...inputProps(id, name, autocomplete, message)} />}
        {message && (
          <p class="field-error" id={`${id}-error`}>
            {message}
          </p>
        )}
      </div>
    );
  };

  const fieldErrors = Object.entries(errors);
  return (
    <main>
      <section class="auth-card panel" aria-labelledby="signin-title">
        <h1 id="signin-title">{creating ? "Create account" : "Sign in"}</h1>
        <p class="lede">{creating ? "Pick a team name; you can build your squad straight after." : "Welcome back to the floodlights."}</p>
        <form ref={form} onSubmit={submit} noValidate key={creating ? "create" : "signin"}>
          {field("email", "Email", "email", "email")}
          {field("password", "Password", "password", creating ? "new-password" : "current-password")}
          {creating && field("team_name", "Team name", "text", "nickname")}
          <button type="submit" class="btn btn-primary" disabled={pending}>
            {pending ? (creating ? "Creating account…" : "Signing in…") : creating ? "Create account" : "Sign in"}
          </button>
        </form>
        <div class={`updates result-strip${announcement.error ? " is-error" : ""}`} role="status" aria-label="Account">
          {announcement.text && <p class="updates">{announcement.text}</p>}
          {fieldErrors.length > 0 && (
            <ul>
              {fieldErrors.map(([name, message]) => (
                <li key={name}>
                  <a
                    href={`#${FIELD_IDS[name] ?? name}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(FIELD_IDS[name] ?? name)?.focus();
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {creating ? (
          <a class="auth-switch" href="/signin" onClick={(event) => switchMode(event, false)}>
            I have an account
          </a>
        ) : (
          <a class="auth-switch" href="/signin?mode=create" onClick={(event) => switchMode(event, true)}>
            Create an account
          </a>
        )}
      </section>
    </main>
  );
}
