import { useRef, useState } from "preact/hooks";
import { request, type User } from "../api";
import { Announcements, FormProblems, PegStrip } from "../components/ui";
import { afterSignIn, settleDraft } from "../session";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [news, setNews] = useState("");
  const busy = useRef(false);
  const summary = useRef<HTMLDivElement>(null);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const answer = await request<{ user: User }>("POST", "/api/session", { email, password });
    if (answer.status === 200) {
      const destination = afterSignIn(new URLSearchParams(window.location.search).get("next"), answer.body.user.role);
      settleDraft(destination, answer.body.user.id);
      window.location.assign(destination);
      return;
    }
    busy.current = false;
    setPending(false);
    setNews(answer.error);
  };

  return (
    <div class="page narrow">
      <PegStrip />
      <h1>Sign in</h1>
      <p class="lede">Members, desk volunteers and the coordinator sign in with their email and password.</p>
      <Announcements label="Account updates" text={news} signInAgain={null} />
      <FormProblems problems={[]} summaryRef={summary} />
      <form class="form-stack" onSubmit={submit} noValidate>
        <label class="field">
          <span class="field-label">Email</span>
          <input type="email" autoComplete="username" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="field-label">Password</span>
          <input type="password" autoComplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        <button type="submit" class={`btn btn-primary${pending ? " is-pending" : ""}`} aria-busy={pending ? "true" : undefined} aria-disabled={pending ? "true" : undefined}>
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p class="note">
        Not a member yet? <a href="/join">Join the library</a>.
      </p>
    </div>
  );
}
