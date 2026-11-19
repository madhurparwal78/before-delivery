// Sign-in: the Spanwise wordmark over a single access-code field.
import { useId, useState, type FormEvent } from "react";
import { api, ApiFailure, type Staff } from "../api";
import { Notice } from "../components/bits";

export function SignInPage({ onSignedIn }: { onSignedIn: (staff: Staff) => void }) {
  const id = useId();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await api<{ staff: Staff }>("POST", "/api/session", { body: { access_code: code } });
      onSignedIn(result.staff);
    } catch (error) {
      if (error instanceof ApiFailure) {
        setFieldError(error.fields.access_code ?? null);
        setMessage(error.fields.access_code ?? error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="signin">
      <div className="signin-sheet">
        <h1 className="wordmark">Spanwise</h1>
        <p className="meta">Vegetation clearance findings, tower by tower.</p>
        <div className="signin-rule" aria-hidden="true" />
        <form onSubmit={(event) => void submit(event)} noValidate>
          <div className="field" data-invalid={fieldError !== null}>
            <label htmlFor={`${id}-code`}>Access code</label>
            <input
              id={`${id}-code`}
              className="figure"
              autoComplete="off"
              spellCheck={false}
              value={code}
              aria-invalid={fieldError !== null}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button type="submit" className="button primary" aria-disabled={pending}>
            {pending ? "Signing in..." : "Sign in"}
          </button>
          <Notice name="Sign-in status" text={message} className="inline-status" />
        </form>
      </div>
    </main>
  );
}
