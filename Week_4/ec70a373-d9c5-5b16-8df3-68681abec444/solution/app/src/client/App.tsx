// The shell: session, role navigation, sign-in at any address, Sign in again, and the screen for the current route.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import type { Me, Role } from "../shared/api.ts";
import { api, errorCopy } from "./api.ts";
import { navigate, useLocation } from "./nav.ts";
import { ActionButton, Dialog, Status, useFieldErrors, usePhoneBand, useStatusRegion, type FieldErrors, type Say } from "./ui.tsx";
import { sessionEndedNow, sessionResumed, sessionSignedIn, sessionSignedOut, useSessionView } from "./session.ts";
import { Book } from "./screens/Book.tsx";
import { Packs } from "./screens/Packs.tsx";
import { Documents } from "./screens/Documents.tsx";
import { TruckLogScreen } from "./screens/TruckLog.tsx";
import { SiteDay } from "./screens/SiteDay.tsx";
import { Compliance } from "./screens/Compliance.tsx";
import { Trucks } from "./screens/Trucks.tsx";
import { Rates } from "./screens/Rates.tsx";
import { Reports } from "./screens/Reports.tsx";
import { Inspect } from "./screens/Inspect.tsx";

interface Screen {
  path: string;
  label: string;
}

function screensFor(me: Me): Screen[] {
  const byRole: Record<Role, Screen[]> = {
    member: [
      { path: "/book", label: "Book" },
      { path: "/packs", label: "Packs" },
      { path: "/documents", label: "Documents" },
      ...(me.member?.truck ? [{ path: "/truck", label: "Truck log" }] : []),
    ],
    kitchen_manager: [
      { path: "/site", label: "Site day" },
      { path: "/compliance", label: "Compliance" },
      { path: "/trucks", label: "Trucks" },
    ],
    finance_lead: [
      { path: "/rates", label: "Rates" },
      { path: "/reports", label: "Reports" },
    ],
  };
  return byRole[me.user.role];
}

const SESSION_ENDED = "Your session has ended. Sign in again.";
const INVALID_CREDENTIALS = "That email and password don't match.";
const EMAIL_INVALID = "Enter a valid email address.";
const PASSWORD_MISSING = "Enter your password.";

/** Sends one sign-in, writes its copy into Sign-in status and field errors, and returns the signed-in user. */
async function postSession(email: string, password: string, say: Say, errors: FieldErrors): Promise<Me | null> {
  errors.clearAll();
  say("Signing in…");
  const result = await api<Me>("/api/session", { method: "POST", body: { email, password } });
  if (result.ok) return result.data;
  if (result.error?.code === "too_many_attempts") {
    const minutes = Math.max(1, Math.ceil((("retryAfter" in result ? result.retryAfter : undefined) ?? 60) / 60));
    say(`Too many sign-in attempts. Try again in ${minutes} minutes.`, "error");
    return null;
  }
  if (result.error?.code === "validation") {
    const fields = result.error.fields ?? {};
    if (fields.email) errors.set("email", EMAIL_INVALID);
    if (fields.password) errors.set("password", PASSWORD_MISSING);
    say(fields.email ? EMAIL_INVALID : PASSWORD_MISSING, "error");
    return null;
  }
  say(errorCopy(result, { invalid_credentials: INVALID_CREDENTIALS }), "error");
  return null;
}

function SignIn({ sessionEnded, onSignedIn }: { sessionEnded: boolean; onSignedIn: (me: Me) => void }): ReactNode {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, say] = useStatusRegion();
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();
  const emailField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!sessionEnded) return;
    say(SESSION_ENDED, "error");
    emailField.current?.focus();
  }, [sessionEnded, say]);
  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const me = await postSession(email, password, say, errors);
    setBusy(false);
    if (me) onSignedIn(me);
  };
  return (
    <main className="signin">
      <form
        className="signin-card"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1 className="screen-title">Sign in</h1>
        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            ref={emailField}
            id="signin-email"
            type="email"
            autoComplete="username"
            value={email}
            {...errors.attrs("email")}
            onChange={(e) => {
              setEmail(e.target.value);
              errors.clear("email");
            }}
          />
          {errors.node("email")}
        </div>
        <div className="field">
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            {...errors.attrs("password")}
            onChange={(e) => {
              setPassword(e.target.value);
              errors.clear("password");
            }}
          />
          {errors.node("password")}
        </div>
        <button type="submit" className="button button-primary" aria-disabled={busy}>
          Sign in
        </button>
        <Status name="Sign-in status" message={status} />
      </form>
    </main>
  );
}

/** Opens over an interrupted dialog; success resumes the page, Sign out and Escape end the session. */
function SignInAgain({ email, onSignedIn, onEnded }: { email: string; onSignedIn: (me: Me) => void; onEnded: () => void }): ReactNode {
  const [password, setPassword] = useState("");
  const [status, say] = useStatusRegion();
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();
  const hadFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const selection = useRef<[number, number] | null>(
    hadFocus.current instanceof HTMLTextAreaElement || hadFocus.current instanceof HTMLInputElement
      ? [hadFocus.current.selectionStart ?? 0, hadFocus.current.selectionEnd ?? 0]
      : null,
  );
  useEffect(() => {
    say(SESSION_ENDED, "error");
  }, [say]);
  const end = (): void => {
    void api("/api/session", { method: "DELETE" });
    onEnded();
  };
  return (
    <Dialog
      title="Sign in again"
      compact
      onClose={end}
      returnFocus={() => {
        const target = hadFocus.current;
        if (target instanceof HTMLTextAreaElement && selection.current) {
          target.focus();
          target.setSelectionRange(selection.current[0], selection.current[1]);
        }
        return target;
      }}
    >
      {() => (
        <form
          className="dialog-form"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            const me = await postSession(email, password, say, errors);
            setBusy(false);
            if (me) onSignedIn(me);
          }}
        >
          <p className="dialog-text">Signed in as {email}</p>
          <div className="field">
            <label htmlFor="again-password">Password</label>
            <input
              id="again-password"
              data-autofocus
              type="password"
              autoComplete="current-password"
              value={password}
              {...errors.attrs("password")}
              onChange={(e) => {
                setPassword(e.target.value);
                errors.clear("password");
              }}
            />
            {errors.node("password")}
          </div>
          <div className="dialog-actions">
            <button type="submit" className="button button-primary" aria-disabled={busy}>
              Sign in and continue
            </button>
            <button type="button" className="button" onClick={end}>
              Sign out
            </button>
          </div>
          <Status name="Sign-in status" message={status} />
        </form>
      )}
    </Dialog>
  );
}

function Wordmark(): ReactNode {
  return (
    <p className="wordmark">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="wordmark-mark">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7c2 2.4 3 4 3 5.6A3 3 0 0 1 9 12.6C9 11 10 9.4 12 7z" />
      </svg>
      Pilotlight
    </p>
  );
}

function MainNavigation({ screens, path }: { screens: Screen[]; path: string }): ReactNode {
  const phone = usePhoneBand();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [phone]);
  useLayoutEffect(() => {
    if (open) panel.current?.querySelector("a")?.focus();
  }, [open]);
  const links = (
    <nav
      ref={panel}
      aria-label="Main"
      className={phone ? "nav nav-panel" : "nav"}
      onKeyDown={(event) => {
        if (phone && event.key === "Escape") {
          setOpen(false);
          menu.current?.focus();
        }
      }}
    >
      {screens.map((s) => (
        <a
          key={s.path}
          href={s.path}
          aria-current={s.path === path ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            setOpen(false);
            navigate(s.path);
          }}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
  if (!phone) return links;
  return (
    <>
      <button
        ref={menu}
        type="button"
        className="button button-quiet menu-button"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        {open ? <X aria-hidden="true" size={18} /> : <Menu aria-hidden="true" size={18} />}
        Menu
      </button>
      {open && links}
    </>
  );
}

export function App(): ReactNode {
  const location = useLocation();
  const inspectToken = /^\/inspect\/([^/]+)$/.exec(location.path)?.[1];
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const view = useSessionView();
  const lastEmail = useRef("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (inspectToken !== undefined) return;
    void api<Me>("/api/me").then((result) => {
      if (result.ok) {
        sessionSignedIn();
        lastEmail.current = result.data.user.email;
        setMe(result.data);
      } else setMe(null);
    });
  }, [inspectToken]);

  const screens = me ? screensFor(me) : [];
  const allowed = screens.some((s) => s.path === location.path);

  useEffect(() => {
    if (me && view === "signed_in" && !allowed && inspectToken === undefined) navigate(screens[0]?.path ?? "/", { replace: true });
  }, [me, view, allowed, inspectToken, screens]);

  if (inspectToken !== undefined) return <Inspect token={inspectToken} />;
  if (me === undefined) return <div className="boot" aria-busy="true" />;
  if (me === null || view === "ended" || view === "signed_out") {
    return (
      <>
        <header className="header">
          <Wordmark />
        </header>
        <SignIn
          sessionEnded={view === "ended"}
          onSignedIn={(next) => {
            sessionSignedIn();
            lastEmail.current = next.user.email;
            setMe(next);
          }}
        />
      </>
    );
  }

  const screen = (() => {
    if (!allowed) return null;
    switch (location.path) {
      case "/book":
        return <Book me={me} />;
      case "/packs":
        return <Packs me={me} />;
      case "/documents":
        return <Documents me={me} />;
      case "/truck":
        return <TruckLogScreen me={me} />;
      case "/site":
        return <SiteDay me={me} />;
      case "/compliance":
        return <Compliance />;
      case "/trucks":
        return <Trucks me={me} />;
      case "/rates":
        return <Rates />;
      case "/reports":
        return <Reports search={location.search} stamp={location.stamp} />;
      default:
        return null;
    }
  })();

  return (
    <>
      <header className="header">
        <Wordmark />
        <MainNavigation screens={screens} path={location.path} />
        <ActionButton
          pending={signingOut}
          className="button button-quiet"
          onPress={() => {
            setSigningOut(true);
            void api("/api/session", { method: "DELETE" }).then((result) => {
              setSigningOut(false);
              if (!result.ok) return;
              navigate("/");
              sessionSignedOut();
              setMe(null);
            });
          }}
        >
          Sign out
        </ActionButton>
      </header>
      <main className="main">{screen}</main>
      {view === "interrupted" && (
        <SignInAgain
          email={lastEmail.current}
          onSignedIn={(next) => {
            lastEmail.current = next.user.email;
            setMe(next);
            sessionResumed();
          }}
          onEnded={sessionEndedNow}
        />
      )}
    </>
  );
}
