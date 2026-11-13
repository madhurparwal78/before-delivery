import type { JSX, Ref } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Me } from "../../shared/api.js";
import { api } from "../api.js";
import { applyCopy, GENERIC, signInCopy } from "../copy.js";
import { navigate, nextParam, nextScreen, type Screen } from "../router.js";
import { announce, landOn, Notice, ScreenHeading, show, tell, useArrivalNotice, useEmailLanding, type NoticeState, type UserChange } from "../ui.js";

type Fields = Record<string, string>;

function Field({ id, label, type = "text", autocomplete, error, value, onInput, inputRef }: {
  id: string; label: string; type?: string; autocomplete: string; error: string | undefined; value: string; onInput: (v: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}): JSX.Element {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} name={id} type={type} autoComplete={autocomplete} value={value} ref={inputRef}
        aria-invalid={error ? "true" : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onInput={(e) => onInput(e.currentTarget.value)} />
      {error ? <p class="field__error" id={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

async function recordIsVisible(screen: Screen): Promise<boolean> {
  if (screen.name === "receipt") return (await api("GET", `/api/bookings/${screen.id}`)).ok;
  if (screen.name === "tenant") return (await api("GET", `/api/tenants/${screen.id}`)).ok;
  return true;
}

/** The screen sign-in returns to: `next` when it passes every check, otherwise the Board. */
async function landing(search: string, me: Me): Promise<string> {
  const next = nextParam(search);
  const screen = next ? nextScreen(next, me.role) : null;
  return next && screen && await recordIsVisible(screen) ? next.value : "/board";
}

export function SignIn({ search, onSignedIn }: { search: string; onSignedIn: UserChange }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useArrivalNotice();
  const [errors, setErrors] = useState<Fields>({});
  const emailRef = useEmailLanding();

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setNotice(tell(signInCopy.pending));
    const result = await api<{ user: Me }>("POST", "/api/session", { json: { email, password } });
    if (result.ok) {
      const target = await landing(search, result.data.user);
      landOn("heading");
      onSignedIn(result.data.user, target);
      return;
    }
    setBusy(false);
    if (result.status === 429) {
      setNotice(tell(signInCopy.limit, "conflict"));
    } else if (result.status === 401) {
      setNotice(tell(signInCopy.wrong, "conflict"));
    } else if (result.status === 422) {
      setErrors(result.error?.fields ?? {});
      setNotice(tell("Fill in this field.", "conflict"));
    } else {
      setNotice(tell(GENERIC, "outage"));
    }
  };

  return (
    <main class="access">
      <p class="access__brand"><span class="brand__mark" aria-hidden="true" />Stationhouse <span>Halfsheet Commissary</span></p>
      <form class="access__form ticket" aria-label="Sign in" onSubmit={(e) => void submit(e)} noValidate>
        <ScreenHeading>Sign in to Stationhouse</ScreenHeading>
        <Field id="email" label="Email" type="email" autocomplete="email" value={email} onInput={setEmail} error={errors.email} inputRef={emailRef} />
        <Field id="password" label="Password" type="password" autocomplete="current-password" value={password} onInput={setPassword} error={errors.password} />
        <button type="submit" class="button button--ink" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <Notice notice={notice} />
        <p class="access__switch">New to the kitchen? <a href="/apply" onClick={(e) => { e.preventDefault(); navigate("/apply"); }}>Apply for a station</a></p>
      </form>
    </main>
  );
}

const APPLY_FIELDS = [
  ["businessName", "Business name", "organization", "text"],
  ["contactName", "Contact name", "name", "text"],
  ["email", "Email", "email", "email"],
  ["password", "Password", "new-password", "password"],
] as const;

export function Apply({ onApplied }: { onApplied: (user: Me) => void }): JSX.Element {
  const [values, setValues] = useState<Fields>({ businessName: "", contactName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Fields>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [refused, setRefused] = useState(0);
  const group = useRef<HTMLDivElement>(null);
  const set = (key: string) => (value: string) => setValues({ ...values, [key]: value });

  useEffect(() => {
    if (refused > 0) group.current?.focus();
  }, [refused]);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setNotice(show(applyCopy.pending));
    const result = await api<{ user: Me }>("POST", "/api/tenants/apply", { json: values });
    setBusy(false);
    if (result.ok) {
      landOn("heading", applyCopy.received);
      onApplied(result.data.user);
      return;
    }
    const fields = result.status === 409 ? { email: applyCopy.taken } : result.status === 422 ? result.error?.fields : undefined;
    if (fields) {
      setNotice(null);
      setErrors(fields);
      setRefused((n) => n + 1);
      announce(applyCopy.count(APPLY_FIELDS.filter(([id]) => fields[id] !== undefined).length));
    } else {
      setNotice(tell(GENERIC, "outage"));
    }
  };

  const failing = APPLY_FIELDS.filter(([id]) => errors[id] !== undefined);
  return (
    <main class="access">
      <p class="access__brand"><span class="brand__mark" aria-hidden="true" />Stationhouse <span>Halfsheet Commissary</span></p>
      <form class="access__form ticket" aria-label="Apply" onSubmit={(e) => void submit(e)} noValidate>
        <ScreenHeading>Apply for a station</ScreenHeading>
        {failing.length > 0 ? (
          <div class="check-fields" role="group" aria-label="Check these fields" tabIndex={-1} ref={group}>
            <p class="check-fields__title">Check these fields</p>
            <ul>
              {failing.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.focus(); }}>{label}: {errors[id]}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {APPLY_FIELDS.map(([id, label, autocomplete, type]) => (
          <Field key={id} id={id} label={label} type={type} autocomplete={autocomplete} value={values[id] ?? ""} onInput={set(id)} error={errors[id]} />
        ))}
        <button type="submit" class="button button--ink" disabled={busy}>{busy ? "Sending application…" : "Send application"}</button>
        <Notice notice={notice} />
        <p class="access__switch">Already cooking here? <a href="/signin" onClick={(e) => { e.preventDefault(); navigate("/signin"); }}>Sign in</a></p>
      </form>
    </main>
  );
}
