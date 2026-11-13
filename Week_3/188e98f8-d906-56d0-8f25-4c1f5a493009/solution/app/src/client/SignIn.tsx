import { useEffect, useRef, useState } from "react";
import { CoasterMark, Banner } from "./ui";
import { useSession } from "./session";

export function SignIn() {
  const { signIn } = useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  return (
    <>
      <Banner />
      <main className="page sign-in-page">
        <section className="mat sign-in-card">
          <CoasterMark size={56} />
          <h1>Desk sign-in</h1>
          <form
            aria-label="Sign in"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              void signIn(code).finally(() => setBusy(false));
            }}
          >
            <label htmlFor="desk-code">Desk code</label>
            <input
              id="desk-code"
              ref={input}
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
            />
            <button type="submit" className="btn" aria-busy={busy}>
              Sign in
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
