/** Accounts in the browser: the signed-in state, the sign-in / create-account dialog, and sign-out. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { COPY } from "../shared/copy.js";
import type { PublicAccount } from "../shared/api-types.js";
import { api, errorOf, NetworkError } from "./api.js";
import { Modal } from "./dialogs.js";
import { useNotify } from "./notices.js";
import { navigate } from "./router.js";

interface SignInRequest {
  readonly title: "Sign in" | "Sign in to hold";
  readonly email?: string;
  readonly focusPassword?: boolean;
  readonly onSuccess?: (account: PublicAccount) => void;
  readonly onDismiss?: () => void;
}

interface Auth {
  readonly account: PublicAccount | null;
  readonly ready: boolean;
  readonly signInOpen: boolean;
  readonly openSignIn: (request?: SignInRequest) => void;
  readonly signOut: () => Promise<void>;
  /** A background read answered 401: the session is gone. */
  readonly sessionLost: () => void;
}

const AuthContext = createContext<Auth | null>(null);

export const useAuth = (): Auth => {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
};

export const AuthProvider = ({ children }: { children: ReactNode }): ReactNode => {
  const notify = useNotify();
  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [ready, setReady] = useState(false);
  const [request, setRequest] = useState<SignInRequest | null>(null);

  useEffect(() => {
    let live = true;
    void api<{ account: PublicAccount }>("GET", "/api/session")
      .then((result) => {
        if (live) setAccount(result.ok ? result.body.account : null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const openSignIn = useCallback((next: SignInRequest = { title: "Sign in" }) => setRequest(next), []);
  const sessionLost = useCallback(() => setAccount(null), []);

  const signOut = useCallback(async () => {
    await api("DELETE", "/api/session").catch(() => undefined);
    setAccount(null);
    const path = window.location.pathname;
    if (path.startsWith("/holds/") || path === "/console") navigate("/finder");
    notify(COPY.signedOut);
  }, [notify]);

  const value = useMemo<Auth>(
    () => ({ account, ready, signInOpen: request !== null, openSignIn, signOut, sessionLost }),
    [account, ready, request, openSignIn, signOut, sessionLost],
  );

  const signedIn = (next: PublicAccount): void => {
    const done = request;
    setAccount(next);
    setRequest(null);
    notify(COPY.signedIn);
    if (next.role === "coordinator") navigate("/console");
    else done?.onSuccess?.(next);
  };

  const dismissed = (): void => {
    const done = request;
    setRequest(null);
    done?.onDismiss?.();
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {request ? <SignInDialog request={request} onSignedIn={signedIn} onClose={dismissed} /> : null}
    </AuthContext.Provider>
  );
};

interface DialogProps {
  readonly request: SignInRequest;
  readonly onSignedIn: (account: PublicAccount) => void;
  readonly onClose: () => void;
}

const SignInDialog = ({ request, onSignedIn, onClose }: DialogProps): ReactNode => {
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(request.email ?? "");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  const failure = (result: Parameters<typeof errorOf>[0]): void => {
    const error = errorOf(result);
    setMessage(error?.fields ? "" : (error?.message ?? ""));
    setFields(error?.fields ?? {});
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    setFields({});
    try {
      if (mode === "create") {
        const result = await api<{ message: string }>("POST", "/api/accounts", { json: { name, email, password } });
        if (result.ok) {
          setMode("signin");
          setPassword("");
          setMessage(result.body.message);
        } else {
          failure(result);
        }
      } else {
        const result = await api<{ account: PublicAccount }>("POST", "/api/session", { json: { email, password } });
        if (result.ok) onSignedIn(result.body.account);
        else failure(result);
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage(COPY.lostReply);
    } finally {
      setPending(false);
    }
  };

  const title = mode === "create" ? "Create an account" : request.title;
  const invalidProps = (key: string): { "aria-invalid"?: true; "aria-describedby"?: string } =>
    fields[key] ? { "aria-invalid": true, "aria-describedby": `auth-${key}-error` } : {};
  const errorText = (key: string): ReactNode =>
    fields[key] ? (
      <p className="field-error" id={`auth-${key}-error`}>
        {fields[key]}
      </p>
    ) : null;

  return (
    <Modal
      label={title}
      onClose={onClose}
      className="modal-sign-in"
      scrim
      initialFocus={(panel) => (request.focusPassword ? panel.querySelector<HTMLElement>('[data-field="password"]') : null)}
    >
      <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
        <h2>{title}</h2>
        {mode === "create" ? (
          <div className="field">
            <label htmlFor="auth-name">Name</label>
            <input id="auth-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} {...invalidProps("name")} />
            {errorText("name")}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} {...invalidProps("email")} />
          {errorText("email")}
        </div>
        <div className="field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            data-field="password"
            role="textbox"
            type="password"
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...invalidProps("password")}
          />
          {errorText("password")}
        </div>
        <p className="form-message" aria-live="polite">
          {message}
        </p>
        <div className="actions">
          <button type="submit" className="button primary-solid" disabled={pending}>
            {mode === "create" ? (pending ? "Creating..." : "Create account") : pending ? "Signing in..." : "Sign in"}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setMode(mode === "create" ? "signin" : "create");
              setMessage("");
              setFields({});
            }}
          >
            {mode === "create" ? "I have an account" : "Create an account"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
