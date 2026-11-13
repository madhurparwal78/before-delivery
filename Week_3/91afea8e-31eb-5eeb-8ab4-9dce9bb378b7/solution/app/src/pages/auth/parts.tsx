import { useEffect, useId, useReducer, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Backdrop } from "../../components/Backdrop";
import { Button } from "../../components/Button";
import { ApiFailure, failureMessage, post } from "../../lib/api";
import { safeNext, useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import type { Account } from "../../lib/types";
import "../../styles/auth.css";

export const COPY = {
  stepOne: "Enter the 6-digit code we sent to your phone.",
  codeSent: "If this number can be used, we'll text a 6-digit code to it.",
  signedOut: "Your session ended. Sign in again to continue.",
  passwordChanged: "Password changed. Other devices are signed out.",
} as const;

export interface Message {
  tone: "info" | "error";
  text: string;
}

const NO_MESSAGE: Message = { tone: "info", text: "" };

export function errorMessage(error: unknown): Message {
  return { tone: "error", text: failureMessage(error) };
}

function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiFailure ? (error.body.errors ?? {}) : {};
}

/** Ten digits, or `91` and ten digits, become the `+91` number the server expects; anything else is sent as typed. */
export function toIdentifier(text: string): string {
  const typed = text.trim();
  const digits = typed.replace(/[\s-]/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\+91[6-9]\d{9}$/.test(digits)) return digits;
  return typed;
}

/** A solid raised panel over the wave field: full width on phones, centred from tablet up. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="auth backdrop-host">
      <Backdrop />
      <section className="auth__panel panel--black">
        <h1 className="auth__title">{title}</h1>
        {children}
      </section>
    </div>
  );
}

export function StatusLine({ message }: { message: Message }): ReactNode {
  return (
    <p role="status" aria-label="Sign-in status" className={`auth__status${message.text && message.tone === "error" ? " auth__status--error" : ""}`}>
      {message.text}
    </p>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string | undefined;
  /** A secret field: masked, and still announced as a text box because the brief names it `textbox`. */
  secret?: boolean;
}

export function TextField({ label, error, secret, ...input }: TextFieldProps): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        {...input}
        id={id}
        type={secret ? "password" : (input.type ?? "text")}
        role={secret ? "textbox" : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface FormState {
  message: Message;
  errors: Record<string, string>;
  busy: boolean;
}

/** One submit handler for a server-calling form: busy while it runs, the server's message and field errors when it fails. */
export function useSubmit(): [FormState, (work: () => Promise<Message | void>) => (event: FormEvent) => void, (message: Message) => void] {
  const [state, setState] = useState<FormState>({ message: NO_MESSAGE, errors: {}, busy: false });
  const submit = (work: () => Promise<Message | void>) => (event: FormEvent) => {
    event.preventDefault();
    setState((previous) => ({ ...previous, busy: true, errors: {} }));
    work().then(
      (message) => setState((previous) => ({ ...previous, busy: false, message: message ?? previous.message })),
      (error: unknown) => setState({ busy: false, message: errorMessage(error), errors: fieldErrors(error) }),
    );
  };
  const show = (message: Message): void => setState((previous) => ({ ...previous, message }));
  return [state, submit, show];
}

export function nextQuery(params: URLSearchParams): string {
  const next = safeNext(params.get("next"));
  return next === null ? "" : `?next=${encodeURIComponent(next)}`;
}

interface CodeState {
  message?: string;
  /** The instant, in milliseconds, when another code may be asked for. */
  deadline?: number;
}

const HOME: Record<Account["role"], string> = { shopper: "/", seller: "/seller/shipments", support: "/support" };

/** Whole seconds left until the deadline, read from the clock on every render, every tick and whenever the tab comes back. */
function useSecondsLeft(deadline: number | null): number {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  const left = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  useEffect(() => {
    if (deadline === null) return undefined;
    const timer = window.setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [deadline]);
  return left;
}

/** The code step shared by sign-in and sign-up: verify, resend with a countdown, then land where the shopper was going. */
export function CodeStep({ kind }: { kind: "signin" | "signup" }): ReactNode {
  const location = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const cart = useCart();
  const arrived = (location.state as CodeState | null) ?? {};
  const [code, setCode] = useState("");
  const [deadline, setDeadline] = useState<number | null>(arrived.deadline ?? null);
  const [resending, setResending] = useState(false);
  const [form, submit, show] = useSubmit();
  const [first, setFirst] = useState<Message>(arrived.message ? { tone: "info", text: arrived.message } : NO_MESSAGE);
  const left = useSecondsLeft(deadline);
  const sent = kind === "signin" ? COPY.stepOne : COPY.codeSent;
  const message = form.message.text ? form.message : first;

  const verify = submit(async () => {
    const result = await post<{ account: Account }>(`/api/auth/${kind}/verify`, { code });
    await auth.signedIn(result.account);
    if (result.account.role === "shopper") {
      try {
        await cart.mergeGuest();
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
      }
    }
    navigate(safeNext(params.get("next")) ?? HOME[result.account.role], { replace: true });
  });

  const resend = (): void => {
    setResending(true);
    post<{ resend_in: number }>("/api/auth/code/resend", {})
      .then((reply) => {
        setDeadline(Date.now() + reply.resend_in * 1000);
        setFirst(NO_MESSAGE);
        show({ tone: "info", text: sent });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && typeof error.body.retry_after === "number") setDeadline(Date.now() + error.body.retry_after * 1000);
        show(errorMessage(error));
      })
      .finally(() => setResending(false));
  };

  return (
    <AuthShell title="enter your code.">
      <form className="stack" onSubmit={verify} noValidate>
        <StatusLine message={message} />
        <TextField
          label="6-digit code"
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          error={form.errors.code}
        />
        <div className="auth__actions">
          <Button type="submit" variant="primary" busy={form.busy}>
            Verify
          </Button>
          <Button onClick={resend} busy={resending} disabled={left > 0}>
            {left > 0 ? `resend in ${left}s` : "Resend code"}
          </Button>
        </div>
        <p role="timer" aria-label="Resend countdown" className="auth__timer">
          {left > 0 ? `${left}s until another code can be sent` : "another code can be sent now"}
        </p>
        <p className="muted">
          {kind === "signin" ? (
            <Link to={`/signin${nextQuery(params)}`}>Use a different account</Link>
          ) : (
            <Link to="/signup">Use different details</Link>
          )}
        </p>
      </form>
    </AuthShell>
  );
}
