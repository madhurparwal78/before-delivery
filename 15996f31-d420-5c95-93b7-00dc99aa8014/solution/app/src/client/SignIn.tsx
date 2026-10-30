import { useEffect, useState, type FormEvent } from "react";
import type { User } from "../shared/api.js";
import { get, post } from "./api.js";
import { genericProblem } from "./copy.js";
import { useFeedback } from "./feedback.js";
import { navigate } from "./hooks.js";
import { Button, TextField } from "./ui/forms.js";

export function SignIn() {
  const feedback = useFeedback();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Sign in · Swarmline Bloom Desk";
    void get<{ user: User }>("/api/me").then((result) => {
      if (result.ok) navigate("/desk", true);
    });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    feedback.clearProblem();
    feedback.update("Signing in…");
    const result = await post<{ user: User }>("/api/session", { email, password });
    setBusy(false);
    if (result.ok) {
      feedback.update("");
      navigate("/desk");
      return;
    }
    feedback.update("");
    feedback.problem(result.status === 401 ? "That email and password don't match a Bloom Desk account." : genericProblem(result));
  };

  return (
    <main className="signin">
      <form className="signin-card" onSubmit={submit} noValidate>
        <p className="wordmark wordmark-large">Swarmline Bloom Desk</p>
        <h1 className="signin-title">Sign in to the season desk</h1>
        <TextField id="signin-email" label="Email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextField
          id="signin-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" variant="primary" busy={busy} className="signin-submit">
          Sign in
        </Button>
        <p className="signin-note">Accounts are set up by your pollination broker.</p>
      </form>
    </main>
  );
}
