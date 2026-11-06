// The account page `/account`: two-step sign-in, the user's own sessions and password, for every
// fully signed-in user, the operator included (brief: Screens and layout, Account page; Interactions,
// Account; Feedback states, Two-step, Sessions, Password).
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatCount, formatTime } from "../shared/format";
import { ApiError, type Me, type SessionRow, type TwoStepState, api, retryAfter } from "./api";
import { generalCopy, throttledSignIn } from "./copy";
import { Dialog, Field, Status } from "./dialog";
import { Icon } from "./icons";
import { follow } from "./router";
import { SignOut } from "./console";

const otherSessions = (n: number): string => (n === 1 ? "1 other session" : `${formatCount(n)} other sessions`);

function codeError(error: unknown): string {
  if (error instanceof ApiError && error.body.errors) return error.body.errors["code"] ?? error.body.errors["recovery_code"] ?? error.message;
  if (error instanceof ApiError && error.code === "rate_limited") return throttledSignIn(retryAfter(error));
  return generalCopy(error);
}

function TwoStep({ initial }: { initial: TwoStepState | null }): JSX.Element {
  const [state, setState] = useState<TwoStepState | null>(initial);
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [status, setStatus] = useState("");

  const load = async (): Promise<void> => setState(await api<TwoStepState>("GET", "/api/me/two-step"));
  useEffect(() => {
    if (!initial) load().catch((e: unknown) => setStatus(generalCopy(e)));
  }, []);

  const start = async (): Promise<void> => {
    try {
      setSetup(await api<{ secret: string; otpauth_uri: string }>("POST", "/api/me/two-step/setup"));
      setStatus("Add this key to your authenticator app, then enter the code it shows.");
    } catch (error) {
      setStatus(generalCopy(error));
    }
  };

  const enable = async (event: Event): Promise<void> => {
    event.preventDefault();
    setStatus("Checking code…");
    try {
      const enabled = await api<{ recovery_codes: string[] }>("POST", "/api/me/two-step/enable", { code });
      setRecovery(enabled.recovery_codes);
      setSetup(null);
      setCode("");
      await load();
      setStatus("Two-step sign-in is on. Save your recovery codes now; Farshore won't show them again.");
    } catch (error) {
      setStatus(codeError(error));
    }
  };

  return (
    <section class="panel" aria-labelledby="two-step-title" role="region">
      <h2 id="two-step-title" class="panel__title">
        Two-step sign-in
      </h2>
      {state?.enabled ? (
        <>
          <p class="panel__line">
            On since <span class="mono">{formatTime(state.enabled_at ?? "")}</span>.{" "}
            <span class="mono">{formatCount(state.recovery_codes_left)}</span> recovery codes left.
          </p>
          {recovery && (
            <ol class="codes" aria-label="Recovery codes">
              {recovery.map((c) => (
                <li key={c} class="mono">
                  {c}
                </li>
              ))}
            </ol>
          )}
          <button type="button" class="button" onClick={() => setTurningOff(true)}>
            Turn off two-step sign-in
          </button>
        </>
      ) : setup ? (
        <form class="form" onSubmit={enable}>
          <Field label="Setup key" hint="Or add it from this setup address.">
            {(described, id) => <input id={id} class="mono-input" readOnly value={setup.secret} aria-describedby={described} />}
          </Field>
          <p class="panel__uri mono">{setup.otpauth_uri}</p>
          <Field label="Authenticator code">
            {(described, id) => (
              <input id={id} class="mono-input" inputMode="numeric" autocomplete="one-time-code" value={code} aria-describedby={described}
                onInput={(e) => setCode(e.currentTarget.value)} />
            )}
          </Field>
          <div class="form__actions">
            <button type="submit" class="button button--primary">
              Verify and turn on
            </button>
          </div>
        </form>
      ) : (
        state && (
          <button type="button" class="button button--primary panel__action" onClick={() => void start()}>
            Turn on two-step sign-in
          </button>
        )
      )}
      <Status label="Two-step status" text={status} />
      {turningOff && (
        <TurnOffDialog
          onClose={() => setTurningOff(false)}
          onDone={async () => {
            setTurningOff(false);
            setRecovery(null);
            await load();
            setStatus("Two-step sign-in is off.");
          }}
          onError={setStatus}
        />
      )}
    </section>
  );
}

function TurnOffDialog({ onClose, onDone, onError }: { onClose: () => void; onDone: () => Promise<void>; onError: (t: string) => void }): JSX.Element {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    try {
      await api("DELETE", "/api/me/two-step", { code });
      await onDone();
    } catch (failure) {
      setError(codeError(failure));
      onError(codeError(failure));
    }
  };
  return (
    <Dialog title="Turn off two-step sign-in" onClose={onClose}>
      <form class="form" onSubmit={submit}>
        <Field label="Authenticator code" error={error}>
          {(described, id) => (
            <input id={id} data-autofocus class="mono-input" inputMode="numeric" autocomplete="one-time-code" value={code}
              aria-describedby={described} onInput={(e) => setCode(e.currentTarget.value)} />
          )}
        </Field>
        <div class="form__actions">
          <button type="button" class="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="button button--primary">
            Turn off
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Sessions({ initial }: { initial: SessionRow[] | null }): JSX.Element {
  const [sessions, setSessions] = useState<SessionRow[]>(initial ?? []);
  const [status, setStatus] = useState("");
  const load = async (): Promise<void> => setSessions((await api<{ sessions: SessionRow[] }>("GET", "/api/me/sessions")).sessions);
  useEffect(() => {
    if (!initial) load().catch((e: unknown) => setStatus(generalCopy(e)));
  }, []);

  const end = async (session: SessionRow): Promise<void> => {
    try {
      await api("DELETE", `/api/me/sessions/${encodeURIComponent(session.id)}`);
      setStatus("Session signed out.");
      await load();
    } catch (error) {
      setStatus(generalCopy(error));
    }
  };

  const endOthers = async (): Promise<void> => {
    try {
      const result = await api<{ ended: number }>("POST", "/api/me/sessions/sign-out-others");
      setStatus(`Signed out ${otherSessions(result.ended)}.`);
      await load();
    } catch (error) {
      setStatus(generalCopy(error));
    }
  };

  return (
    <section class="panel" aria-labelledby="sessions-title" role="region">
      <h2 id="sessions-title" class="panel__title">
        Sessions
      </h2>
      <div class="table-frame">
        <table class="table table--cards" aria-label="Sessions">
          <thead>
            <tr>
              <th scope="col">Device</th>
              <th scope="col">Signed in (UTC)</th>
              <th scope="col">Last seen (UTC)</th>
              <th scope="col" class="cell--actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td data-label="Device" class="cell--wrap">
                  {s.device}
                </td>
                <td data-label="Signed in (UTC)" class="mono cell--nowrap">{formatTime(s.created_at)}</td>
                <td data-label="Last seen (UTC)" class="mono cell--nowrap">{formatTime(s.last_seen_at)}</td>
                <td class="cell--actions">
                  {s.current ? (
                    <span class="state state--current">This session</span>
                  ) : (
                    <button type="button" class="button button--small" onClick={() => void end(s)}>
                      Sign out session from {formatTime(s.created_at)}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="form__actions form__actions--start">
        <button type="button" class="button" onClick={() => void endOthers()}>
          Sign out other sessions
        </button>
      </div>
      <Status label="Sessions status" text={status} />
    </section>
  );
}

function Password(): JSX.Element {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  const change = async (event: Event): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setStatus("Changing password…");
    try {
      const result = await api<{ ended_sessions: number }>("PUT", "/api/me/password", { current_password: current, new_password: next });
      setCurrent("");
      setNext("");
      setStatus(`Password changed. ${otherSessions(result.ended_sessions)} signed out.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "invalid_credentials") setStatus("Your current password is incorrect.");
      else if (error instanceof ApiError && error.code === "rate_limited") setStatus(throttledSignIn(retryAfter(error)));
      else if (error instanceof ApiError && error.body.errors?.["new_password"]) setStatus(error.body.errors["new_password"]);
      else setStatus(generalCopy(error));
    }
    setPending(false);
  };

  return (
    <section class="panel" aria-labelledby="password-title" role="region">
      <h2 id="password-title" class="panel__title">
        Password
      </h2>
      <form class="form" onSubmit={change}>
        <Field label="Current password">
          {(described, id) => (
            <input id={id} type="password" autocomplete="current-password" value={current} aria-describedby={described}
              onInput={(e) => setCurrent(e.currentTarget.value)} />
          )}
        </Field>
        <Field label="New password" hint="12 to 128 characters.">
          {(described, id) => (
            <input id={id} type="password" autocomplete="new-password" value={next} aria-describedby={described}
              onInput={(e) => setNext(e.currentTarget.value)} />
          )}
        </Field>
        <div class="form__actions form__actions--start">
          <button type="submit" class="button button--primary" disabled={pending}>
            Change password
          </button>
        </div>
      </form>
      <Status label="Password status" text={status} />
    </section>
  );
}

// Both lists load before the panels render, so neither panel grows and pushes the next one down after first paint.
// A failed load leaves that panel to retry and report in its own status line.
type Loaded = { twoStep: TwoStepState | null; sessions: SessionRow[] | null };

export function Account({ me }: { me: Me }): JSX.Element {
  const home = me.user.operator ? "/ops" : "/console";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    void Promise.allSettled([api<TwoStepState>("GET", "/api/me/two-step"), api<{ sessions: SessionRow[] }>("GET", "/api/me/sessions")]).then(
      ([twoStep, sessions]) => setLoaded({
        twoStep: twoStep.status === "fulfilled" ? twoStep.value : null,
        sessions: sessions.status === "fulfilled" ? sessions.value.sessions : null,
      }),
    );
  }, []);
  return (
    <div class="account">
      <header class="account__bar">
        <a class="wordmark" href={home} onClick={(e) => follow(e, home)}>
          <span class="wordmark__dot" aria-hidden="true" />
          Farshore
        </a>
        <a class="button button--quiet" href={home}>
          <Icon name="chevron-left" />
          {me.user.operator ? "Operator console" : "Console"}
        </a>
        <SignOut />
      </header>
      <main class="account__main">
        <h1 class="page__title">Account</h1>
        <p class="account__who">
          {me.user.name} · <span class="mono">{me.user.email}</span>
        </p>
        {loaded && (
          <>
            <TwoStep initial={loaded.twoStep} />
            <Sessions initial={loaded.sessions} />
            <Password />
          </>
        )}
      </main>
    </div>
  );
}
