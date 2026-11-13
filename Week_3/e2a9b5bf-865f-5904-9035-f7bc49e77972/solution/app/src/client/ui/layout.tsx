import type { ComponentChildren } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { COPY } from "../../shared/messages";
import { useSelect } from "../lib/store";
import { currentPathAndQuery, useLocation } from "../lib/router";
import { app, isOffline } from "../state/model";
import { RingIcon } from "./icons";
import { signOut } from "../state/auth";
import { createStore } from "../lib/store";

/** Set by screens whose id the device does not hold while offline. */
export const connection = createStore<{ notHere: boolean }>({ notHere: false });

function Connection() {
  const offline = useSelect(app, (s) => isOffline(s));
  const expired = useSelect(app, (s) => s.expired);
  const waiting = useSelect(app, (s) => s.journal.length);
  const notice = useSelect(app, (s) => s.notice);
  const notHere = useSelect(connection, (s) => s.notHere);
  const { path, search } = useLocation();
  const next = encodeURIComponent(path + search);
  return (
    <div role="status" aria-label="Connection" class="sentences">
      {offline && !expired ? <p class="sentence">{COPY.offlineBanner}</p> : null}
      {expired && waiting > 0 ? (
        <p class="sentence">
          You're signed out.{" "}
          <a class="inline-link" href={`/signin?next=${next}`}>
            Sign in
          </a>
          {waiting === 1 ? " to send 1 waiting change." : ` to send ${waiting} waiting changes.`}
        </p>
      ) : null}
      {notHere ? <p class="sentence">{COPY.notOnDevice}</p> : null}
      {waiting > 0 ? <p class="sentence">{waiting === 1 ? COPY.waitingOne : COPY.waitingMany(waiting)}</p> : null}
      {notice ? <p class="sentence">{notice}</p> : null}
    </div>
  );
}

function SyncResults() {
  const sentences = useSelect(app, (s) => s.syncSentences);
  return (
    <div role="status" aria-label="Sync results" class="sentences">
      {sentences.map((sentence, i) => (
        <p key={`${i}-${sentence}`} class="sentence">
          {sentence}
        </p>
      ))}
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: string }) {
  const { path } = useLocation();
  const current = path === to || (to !== "/tonight" && path.startsWith(`${to}/`));
  return (
    <a href={to} class={`nav-link${current ? " current" : ""}`} aria-current={current ? "page" : undefined}>
      {children}
    </a>
  );
}

export function Footer() {
  return <footer class="footer">Lowlamp Instruments · Lowlamp Field Log</footer>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div class="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div class="skeleton-row" key={i} />
      ))}
    </div>
  );
}

interface ScreenProps {
  heading: ComponentChildren;
  children: ComponentChildren;
  className?: string;
}

/** A signed-in screen: navigation line, heading, Connection and Sync results, then the content. */
export function WorkingScreen({ heading, children, className }: ScreenProps) {
  useLayoutEffect(() => {
    connection.set({ notHere: false });
    return () => connection.set({ notHere: false });
  }, [currentPathAndQuery()]);
  return (
    <div class={`screen ${className ?? ""}`}>
      <div class="column">
        <nav aria-label="Main" class="mainnav">
          <NavLink to="/tonight">Tonight</NavLink>
          <NavLink to="/programs">Programs</NavLink>
          <NavLink to="/kit">Kit</NavLink>
          <button type="button" class="nav-link nav-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
        <h1>{heading}</h1>
        <Connection />
        <SyncResults />
        {children}
      </div>
      <Footer />
    </div>
  );
}

export function NotFoundScreen() {
  const signedIn = useSelect(app, (s) => s.auth === "in");
  return (
    <div class="screen">
      <div class="column">
        {signedIn ? (
          <nav aria-label="Main" class="mainnav">
            <NavLink to="/tonight">Tonight</NavLink>
            <NavLink to="/programs">Programs</NavLink>
            <NavLink to="/kit">Kit</NavLink>
            <button type="button" class="nav-link nav-signout" onClick={() => void signOut()}>
              Sign out
            </button>
          </nav>
        ) : (
          <nav aria-label="Main" class="mainnav">
            <a class="nav-link" href="/">
              Lowlamp
            </a>
          </nav>
        )}
        {signedIn ? <Connection /> : null}
        <div class="empty">
          <RingIcon />
          <p class="sentence">{COPY.notFound}</p>
        </div>
      </div>
      <Footer />
    </div>
  );
}
