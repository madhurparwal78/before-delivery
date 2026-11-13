import { useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/messages";
import { signIn, signUp } from "../state/auth";
import { Footer } from "../ui/layout";
import { FieldShell, nextId, useSingleFlight } from "../ui/form";

export function AuthScreen({ mode }: { mode: "signin" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const flight = useSingleFlight();
  const ids = useRef({ email: nextId("email"), password: nextId("password"), name: nextId("name") });
  const refs = { email: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null), display_name: useRef<HTMLInputElement>(null) };

  const submit = (event: Event) => {
    event.preventDefault();
    void flight(async () => {
      setProblem("");
      setErrors({});
      const outcome = mode === "signin" ? await signIn(email, password) : await signUp(email, password, name);
      if (outcome.ok) return;
      if (outcome.status === 0) return setProblem(COPY.needsSignal);
      if (outcome.status === 422 && outcome.body.fields) {
        setErrors(outcome.body.fields);
        const order = ["email", "password", "display_name"] as const;
        const first = order.find((key) => key in (outcome.body.fields ?? {}));
        if (first) refs[first].current?.focus();
        return;
      }
      if (outcome.status === 409) return setProblem(COPY.emailTaken);
      if (outcome.status === 429) return setProblem(COPY.tooManyAttempts);
      if (outcome.status === 401) return setProblem(COPY.signinFailed);
      setProblem(COPY.serverError);
    });
  };

  const signup = mode === "signup";
  return (
    <div class="screen">
      <div class="column">
        <nav class="mainnav" aria-label="Main">
          <a class="nav-link" href="/">
            Lowlamp
          </a>
        </nav>
        <h1>{signup ? "Create your account" : "Sign in"}</h1>
        <form class="stack" onSubmit={submit} noValidate>
          <FieldShell label="Email" id={ids.current.email} error={errors.email}>
            <input
              id={ids.current.email}
              ref={refs.email}
              type="email"
              autocomplete="email"
              value={email}
              aria-invalid={errors.email ? "true" : undefined}
              aria-describedby={errors.email ? `${ids.current.email}-error` : undefined}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />
          </FieldShell>
          <FieldShell label="Password" id={ids.current.password} error={errors.password}>
            <input
              id={ids.current.password}
              ref={refs.password}
              type="password"
              role="textbox"
              autocomplete={signup ? "new-password" : "current-password"}
              value={password}
              aria-invalid={errors.password ? "true" : undefined}
              aria-describedby={errors.password ? `${ids.current.password}-error` : undefined}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            />
          </FieldShell>
          {signup ? (
            <FieldShell label="Your name" id={ids.current.name} error={errors.display_name}>
              <input
                id={ids.current.name}
                ref={refs.display_name}
                type="text"
                autocomplete="name"
                value={name}
                aria-invalid={errors.display_name ? "true" : undefined}
                aria-describedby={errors.display_name ? `${ids.current.name}-error` : undefined}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
            </FieldShell>
          ) : null}
          <div role="alert" aria-label="Account problem" class="sentences">
            {problem ? <p class="sentence">{problem}</p> : null}
          </div>
          <button type="submit" class="btn primary">
            {signup ? "Create account" : "Sign in"}
          </button>
        </form>
        <p class="hint">
          {signup ? (
            <>
              Already have an account? <a href="/signin">Sign in</a>
            </>
          ) : (
            <>
              New here? <a href="/signup">Create an account</a>
            </>
          )}
        </p>
      </div>
      <Footer />
    </div>
  );
}
