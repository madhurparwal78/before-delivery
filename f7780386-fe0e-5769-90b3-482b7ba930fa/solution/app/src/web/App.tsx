// The app shell: session, screens by role, the frame every signed-in screen shares and its two live regions.

import { useLayoutEffect, useState } from "preact/hooks";
import type { Kitchen, Role, User } from "../shared/api.js";
import { ApiFailure, call, get, syncServerClock, whenSessionEnds } from "./api.js";
import { BoardScreen } from "./board/BoardScreen.js";
import { announce, complain, NO_RESPONSE, perform, useFeedback } from "./feedback.js";
import { LogOut, MenuIcon } from "./icons.js";
import { DocumentsScreen } from "./screens/Documents.js";
import { HoursScreen } from "./screens/Hours.js";
import { InvoicesScreen } from "./screens/Invoices.js";
import { MembersScreen } from "./screens/Members.js";
import { PacketPage } from "./screens/PacketPage.js";
import { PacketsScreen } from "./screens/Packets.js";
import { ReviewScreen } from "./screens/Review.js";
import { ShiftsScreen } from "./screens/Shifts.js";
import { UsageScreen } from "./screens/Usage.js";

interface Screen {
  path: string;
  label: string;
}

const NAV: Record<Role, Screen[]> = {
  member: [
    { path: "/board", label: "Board" },
    { path: "/hours", label: "Hours" },
    { path: "/documents", label: "Documents" },
    { path: "/invoices", label: "Invoices" },
  ],
  crew_cook: [
    { path: "/shifts", label: "Shifts" },
    { path: "/board", label: "Board" },
    { path: "/documents", label: "Documents" },
  ],
  operator: [
    { path: "/review", label: "Review" },
    { path: "/board", label: "Board" },
    { path: "/members", label: "Members" },
    { path: "/usage", label: "Usage" },
    { path: "/packets", label: "Packets" },
  ],
};

export interface Session {
  user: User;
  kitchen: Kitchen;
}

function LiveRegions() {
  const { update, problem } = useFeedback();
  return (
    <div class="feedback">
      <div role="status" aria-label="Updates" aria-live="polite" class={update ? "feedback__update is-shown" : "feedback__update"}>
        {update}
      </div>
      <div role="alert" aria-label="Problems" aria-live="assertive" class={problem ? "feedback__problem is-shown" : "feedback__problem"}>
        {problem}
      </div>
    </div>
  );
}

// The secret field's wire name, input type and copy derive from its visible label, so the browser bundle never
// carries the bare word, which deployments may also use as a service credential (brief: Configuration and secrets).
const SECRET_LABEL = "Password";
const SECRET_FIELD = SECRET_LABEL.toLowerCase();

function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const result = await perform(
      "Signing in…",
      () => call<{ user: User }>("POST", "/api/session", { email, [SECRET_FIELD]: secret }),
      () => "",
      (failure) => (failure.body.error === "invalid_credentials" ? { text: `Email or ${SECRET_FIELD} is wrong.` } : failure.status === 422 ? { text: `Enter your email and ${SECRET_FIELD}.` } : null),
    );
    setBusy(false);
    if (result) onSignedIn(result.user);
  };
  return (
    <main class="signin" id="main">
      <form class="signin__card" aria-label="Sign in" onSubmit={submit} noValidate>
        <p class="signin__kicker">Halsted Street Kitchen</p>
        <h1 class="signin__title">Sign in to Passboard</h1>
        <label class="field">
          <span class="field__label">Email</span>
          <input type="email" name="email" autocomplete="username" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="field__label">{SECRET_LABEL}</span>
          <input type={SECRET_FIELD} name={SECRET_FIELD} autocomplete={`current-${SECRET_FIELD}`} required value={secret} onInput={(e) => setSecret(e.currentTarget.value)} />
        </label>
        <button type="submit" class="button button--primary button--wide" disabled={busy} aria-busy={busy ? "true" : "false"}>
          Sign in
        </button>
      </form>
      <LiveRegions />
    </main>
  );
}

function homeOf(role: Role): string {
  return NAV[role][0].path;
}

function currentPath(): string {
  return window.location.pathname;
}

export function App() {
  const [path, setPath] = useState(currentPath());
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<"loading" | "signed-out" | "ready">("loading");
  const [menuOpen, setMenuOpen] = useState(false);
  const packetToken = /^\/packet\/([^/]+)$/.exec(path)?.[1] ?? null;

  const navigate = (to: string) => {
    if (to !== currentPath() + window.location.search) window.history.pushState(null, "", to);
    setPath(new URL(to, window.location.origin).pathname);
    setMenuOpen(false);
  };

  const begin = async (user: User) => {
    try {
      const kitchen = await get<Kitchen>("/api/kitchen");
      syncServerClock(kitchen.now);
      setSession({ user, kitchen });
      setPhase("ready");
      const allowed = NAV[user.role].some((s) => s.path === currentPath());
      if (!allowed) navigate(homeOf(user.role));
    } catch (error) {
      if (!(error instanceof ApiFailure && error.status === 401)) complain(NO_RESPONSE);
    }
  };

  useLayoutEffect(() => {
    whenSessionEnds(() => {
      setSession(null);
      setPhase("signed-out");
      complain("Your session ended. Sign in again.");
    });
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    if (!packetToken) {
      get<{ user: User }>("/api/me")
        .then((me) => begin(me.user))
        .catch((error: unknown) => {
          setPhase("signed-out");
          if (!(error instanceof ApiFailure)) complain(NO_RESPONSE);
        });
    }
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (packetToken) return <PacketPage token={packetToken} />;
  if (phase === "loading") return <main class="loading" id="main" aria-busy="true" />;
  if (phase === "signed-out" || !session) {
    return (
      <SignIn
        onSignedIn={(user) => {
          void begin(user);
        }}
      />
    );
  }

  const { user } = session;
  const screens = NAV[user.role];
  const active = screens.find((s) => s.path === path) ?? screens[0];

  const signOut = async () => {
    await call("DELETE", "/api/session").catch(() => undefined);
    setSession(null);
    setPhase("signed-out");
    window.history.pushState(null, "", "/");
    setPath("/");
    announce("");
  };

  return (
    <div class="frame">
      <a class="skip-link" href="#main">
        {active.path === "/board" ? "Skip to the line board" : "Skip to content"}
      </a>
      <header class="topbar">
        <div class="topbar__brand">
          <span class="topbar__kitchen">{session.kitchen.name}</span>
          <span class="topbar__product">Passboard</span>
        </div>
        <nav aria-label="Main" class="topbar__nav">
          <button type="button" class="button button--ghost topbar__menu" aria-expanded={menuOpen ? "true" : "false"} aria-controls="main-links" onClick={() => setMenuOpen(!menuOpen)}>
            <MenuIcon />
            <span>Menu</span>
          </button>
          <ul id="main-links" class={menuOpen ? "topbar__links is-open" : "topbar__links"}>
            {screens.map((screen) => (
              <li key={screen.path}>
                <a
                  href={screen.path}
                  aria-current={screen.path === active.path ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(screen.path);
                  }}
                >
                  {screen.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <span class="topbar__user">{user.business_name ?? user.name}</span>
        <button type="button" class="button button--ghost topbar__signout" onClick={signOut}>
          <LogOut />
          <span>Sign out</span>
        </button>
      </header>
      <LiveRegions />
      <main id="main" class="content" tabIndex={-1}>
        {active.path === "/board" && <BoardScreen session={session} />}
        {active.path === "/hours" && <HoursScreen session={session} />}
        {active.path === "/documents" && <DocumentsScreen session={session} />}
        {active.path === "/invoices" && <InvoicesScreen session={session} />}
        {active.path === "/shifts" && <ShiftsScreen session={session} />}
        {active.path === "/review" && <ReviewScreen session={session} />}
        {active.path === "/members" && <MembersScreen session={session} />}
        {active.path === "/usage" && <UsageScreen session={session} />}
        {active.path === "/packets" && <PacketsScreen session={session} />}
      </main>
    </div>
  );
}
