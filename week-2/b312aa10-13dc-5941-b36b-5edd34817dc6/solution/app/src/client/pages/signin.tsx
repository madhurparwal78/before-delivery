import { useRef, useState } from "preact/hooks";
import { get, post } from "../api.js";
import { navigate, returnTarget } from "../router.js";
import { announce, context } from "../store.js";
import { Button, Field, useAction } from "../ui.js";
import type { KitchenInfo, SessionInfo } from "../types.js";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const { busy, run } = useAction();
  const submit = (e: Event): void => {
    e.preventDefault();
    void run("signin", "Signing in…", async () => {
      const session = (await post<SessionInfo>("/api/session", { email, password })).data;
      const kitchen = (await get<KitchenInfo>("/api/kitchen")).data;
      context.set({ session, kitchen });
      navigate(returnTarget(location.search));
      // Success opens the return address (or the board); the pending copy does not outlive the sign-in.
      announce("");
      return null;
    }, () => {
      // A refusal (wrong credentials, throttled) clears the password and returns to Email.
      setPassword("");
      queueMicrotask(() => form.current?.querySelector<HTMLInputElement>("input[type=email]")?.focus());
      return false;
    });
  };
  return (
    <main class="signin">
      <form ref={form} class="signin-panel" onSubmit={submit} noValidate>
        <p class="signin-brand">Lineboard</p>
        <h1>Sign in</h1>
        <p class="signin-lede">Pass Window Software for shared commercial kitchens.</p>
        <Field label="Email">{(p) => <input {...p} class="input" type="email" autoComplete="username" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />}</Field>
        <Field label="Password">{(p) => <input {...p} class="input" type="password" autoComplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />}</Field>
        <Button type="submit" variant="primary" busy={busy === "signin"}>Sign in</Button>
      </form>
    </main>
  );
}
