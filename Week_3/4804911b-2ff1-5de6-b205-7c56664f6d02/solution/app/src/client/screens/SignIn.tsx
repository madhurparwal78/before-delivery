import { useEffect, useRef, useState } from "preact/hooks";
import { COPY, waitMessage as waitSentence, waitTime } from "../../shared/copy";
import type { Session } from "../../shared/types";
import { useEvery } from "../lib/hooks";
import { ApiFailure, get, messageOf, post } from "../lib/net";
import { navigate } from "../lib/router";
import { clearEnded, endedSession, reconcileHeld, homeFor, setSession } from "../lib/session";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(endedSession() ? COPY.endedSession : "");
  const [wait, setWait] = useState<{ until: number; message: string } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const pending = useRef(false);
  const waitRef = useRef(wait);
  waitRef.current = wait;
  const afterEnded = useRef(endedSession());

  const enter = (s: Session) => {
    reconcileHeld(s.accountId);
    setSession(s);
    clearEnded();
    navigate(homeFor(s));
  };

  // after an ended session the tab watches for a session to appear (another tab signed in)
  useEvery(afterEnded.current ? 5000 : null, () => {
    void get<Session>("/api/session", { quiet: true }).then(enter).catch(() => undefined);
  });

  useEvery(wait ? 200 : null, () => {
    const w = waitRef.current;
    if (!w) return;
    const left = Math.ceil((w.until - performance.now()) / 1000);
    if (left > 0) return setRemaining(left);
    setRemaining(0);
    setWait(null);
    setStatus((s) => (s === w.message ? "" : s));
  });
  useEffect(() => {
    setRemaining(wait ? Math.max(1, Math.ceil((wait.until - performance.now()) / 1000)) : 0);
  }, [wait]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (pending.current || (waitRef.current && waitRef.current.until > performance.now())) return;
    pending.current = true;
    setStatus("Signing in.");
    try {
      const s = await post<Session>("/api/session", { email, password }, { quiet: true });
      afterEnded.current = false;
      enter(s);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 429) {
        const seconds = error.retryAfter ?? 1;
        const message = error.body.message || waitSentence(seconds);
        setWait({ until: performance.now() + seconds * 1000, message });
        setStatus(message);
      } else setStatus(error instanceof ApiFailure && error.body.error === "bad_credentials" ? error.body.message : messageOf(error, COPY.unavailable));
    } finally {
      pending.current = false;
    }
  };

  const waiting = remaining > 0;
  return (
    <main class="signin">
      <h1>Sign in</h1>
      <form class="block" onSubmit={(e) => void submit(e)} noValidate>
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="username" value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)} />
        <button type="submit" class="rect-button" aria-disabled={waiting ? "true" : undefined} onClick={(e) => waiting && e.preventDefault()}>
          Sign in
        </button>
        <div role="status" aria-label="Sign-in status" class="status">
          {status}
        </div>
        {waiting && (
          <div role="timer" aria-label="Wait time" class="timer">
            {waitTime(remaining)}
          </div>
        )}
      </form>
    </main>
  );
}
