import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiFailure, api } from "../lib/api";
import { clearScreensExcept } from "../lib/persist";
import { navigate, useLocation } from "../lib/router";
import { landingPath } from "../shell";
import { clearSignInMemory, readSignInMemory, safeNext, useSession, writeSignInMemory } from "../session";
import type { Me } from "../types";

type FocusSpot = "email" | "password" | "submit" | "alert";

function minutesFor(retryAfter: number): number {
  return Math.ceil(retryAfter / 60);
}

export function SignIn() {
  const { setMe } = useSession();
  const { search } = useLocation();
  const next = new URLSearchParams(search).get("next");
  const remembered = useRef(readSignInMemory());
  const [email, setEmail] = useState(remembered.current?.email ?? "");
  const [password, setPassword] = useState("");
  const [alertText, setAlertText] = useState(remembered.current?.alert ?? "");
  const [lock, setLock] = useState<{ since: number; retryAfter: number } | null>(null);
  const [now, setNow] = useState(0);
  const [alertFocus, setAlertFocus] = useState(0);
  const emailBox = useRef<HTMLInputElement | null>(null);
  const passwordBox = useRef<HTMLInputElement | null>(null);
  const submitButton = useRef<HTMLButtonElement | null>(null);
  const alertBox = useRef<HTMLDivElement | null>(null);

  const spots: Record<FocusSpot, { current: HTMLElement | null }> = { email: emailBox, password: passwordBox, submit: submitButton, alert: alertBox };

  useEffect(() => {
    spots[remembered.current?.focus ?? "email"].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remember = (focus: FocusSpot, text: string = alertText, address: string = email) => writeSignInMemory({ email: address, focus, alert: text });

  const secondsLeft = lock ? Math.max(0, lock.retryAfter - Math.floor((now - lock.since) / 1000)) : 0;
  const locked = lock !== null && secondsLeft > 0;

  useEffect(() => {
    if (!lock) return undefined;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [lock]);

  useEffect(() => {
    if (lock && secondsLeft === 0) setLock(null);
  }, [lock, secondsLeft]);

  useEffect(() => {
    if (alertFocus > 0) alertBox.current?.focus();
  }, [alertFocus]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    setAlertText("Signing in...");
    try {
      const answer = await api<{ landing: string }>("POST", "/api/session", { email, password });
      const me = await api<Me>("GET", "/api/me");
      clearScreensExcept(me.user.id);
      clearSignInMemory();
      setMe(me);
      navigate(safeNext(next, me.user.role) ?? answer.landing ?? landingPath(me), { replace: true });
    } catch (error) {
      setPassword("");
      if (error instanceof ApiFailure && error.code === "too_many_attempts") {
        const retryAfter = Number(error.body.retry_after);
        const text = `Too many attempts. Try again in ${minutesFor(retryAfter)} minutes.`;
        setAlertText(text);
        setLock({ since: performance.now(), retryAfter });
        setNow(performance.now());
        remember("alert", text);
        setAlertFocus((tick) => tick + 1);
      } else {
        const text = error instanceof ApiFailure && error.code === "invalid_credentials" ? "Email or password is wrong." : "Something went wrong. Try again.";
        setAlertText(text);
        remember("email", text);
        emailBox.current?.focus();
      }
    }
  }

  return (
    <main className="signin">
      <h1>Sign in</h1>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="alert-slot">
          <div ref={alertBox} role="alert" tabIndex={-1} className={alertText ? "alert-block" : "alert-block empty"} onFocus={() => remember("alert")}>
            {alertText}
          </div>
          {locked ? (
            <p role="timer" aria-label="Sign-in locked" data-seconds-left={secondsLeft} className="lock-timer">{secondsLeft} s</p>
          ) : null}
        </div>
        <label className="field-label" htmlFor="email">Email</label>
        <input
          id="email" ref={emailBox} className="field" type="email" autoComplete="username" value={email}
          onChange={(event) => { setEmail(event.target.value); remember("email", alertText, event.target.value); }}
          onFocus={() => remember("email")}
        />
        <label className="field-label" htmlFor="password">Password</label>
        <input
          id="password" ref={passwordBox} className="field" type="password" autoComplete="current-password" value={password}
          onChange={(event) => setPassword(event.target.value)} onFocus={() => remember("password")}
        />
        <button ref={submitButton} type="submit" className="btn block" aria-disabled={locked} onFocus={() => remember("submit")}>Sign in</button>
      </form>
    </main>
  );
}
