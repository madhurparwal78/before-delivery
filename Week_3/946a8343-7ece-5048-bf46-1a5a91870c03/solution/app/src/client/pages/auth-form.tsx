// Shared body of /sign-in and /sign-up (not a route). Checks the two fields locally with the brief's texts, shows an error
// summary plus field errors, shows API refusals as a notice (useAction also announces them), and on success stores the user and
// goes to ?next= (same-origin paths only) or `/`, landing focus on `heading "Your projects"` when that is where it ends up.
import { useRef, useState } from "preact/hooks";
import { api, useAction } from "../api.ts";
import { parseUser } from "../config.ts";
import { A, navigate, requestFocusOnArrival, useQuery } from "../router.ts";
import { setUser } from "../session.ts";
import { Button } from "../ui/button.tsx";
import { ErrorSummary, Notice } from "../ui/feedback.tsx";
import { TextField } from "../ui/fields.tsx";
import { useTitle } from "../ui/page.tsx";
import { Main } from "../shell/main.tsx";
import { isRecord } from "../util.ts";

const USERNAME_TEXT = "Username must be 3 to 24 characters: a-z, 0-9 and _.";
const PASSWORD_TEXT = "Password must be at least 8 characters.";

function localErrors(username: string, password: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^[a-z0-9_]{3,24}$/.test(username.trim().toLowerCase())) errors.username = USERNAME_TEXT;
  if (password.length < 8) errors.password = PASSWORD_TEXT;
  return errors;
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const signIn = mode === "sign-in";
  const title = signIn ? "Sign in" : "Create account";
  useTitle(title);
  const next = safeNext(useQuery().get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  const submit = useAction(async () => {
    const body: unknown = await (signIn
      ? api.post("/api/session", { username: username.trim().toLowerCase(), password })
      : api.post("/api/users", { username: username.trim().toLowerCase(), password }));
    const user = parseUser(isRecord(body) ? body.user : null);
    if (user) setUser(user);
    const target = new URL(next, location.origin);
    requestFocusOnArrival(target.pathname);
    navigate(next);
  });

  const serverFields = submit.error?.status === 422 ? submit.error.fieldErrors() : {};
  const shown = Object.keys(problems).length > 0 ? problems : serverFields;
  const summary = Object.entries(shown).map(([field, message]) => ({ field, message }));
  const refusal = submit.error && Object.keys(serverFields).length === 0 ? submit.error.message : null;

  return (
    <Main class="sp-auth">
      <div class="sp-auth__panel">
        <h1 ref={heading} tabIndex={-1} class="sp-auth__title">
          {title}
        </h1>
        <p class="sp-auth__lede">{signIn ? "Pick up where you stopped." : "One account for every group and project."}</p>
        <form
          noValidate
          class="sp-auth__form"
          onSubmit={(event) => {
            event.preventDefault();
            const found = localErrors(username, password);
            setProblems(found);
            if (Object.keys(found).length > 0) {
              setAttempt(attempt + 1);
              return;
            }
            void submit.run();
          }}
        >
          <ErrorSummary errors={summary} focusSignal={attempt} />
          {refusal ? <Notice>{refusal}</Notice> : null}
          <TextField
            label="Username"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            value={username}
            onInput={(event) => setUsername(event.currentTarget.value)}
            error={shown.username}
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            autocomplete={signIn ? "current-password" : "new-password"}
            value={password}
            onInput={(event) => setPassword(event.currentTarget.value)}
            error={shown.password}
          />
          <Button type="submit" pending={submit.pending}>
            {title}
          </Button>
        </form>
        <p class="sp-auth__switch">
          {signIn ? (
            <>
              New here? <A href="/sign-up">Create an account</A>
            </>
          ) : (
            <>
              Already have an account? <A href="/sign-in">Go to sign in</A>
            </>
          )}
        </p>
      </div>
    </Main>
  );
}
