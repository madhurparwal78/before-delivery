import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import { ApiFailure, post } from "../api";
import { announce } from "../announcer";
import { M56 } from "../messages";
import { setMe, signOut, useMe } from "../me";
import { Link, navigate, useLocation } from "../router";

const LINKS = [
  { href: "/daily", name: "Daily" },
  { href: "/duel", name: "Duel" },
  { href: "/leaderboard", name: "Leaderboard" },
  { href: "/profile", name: "Profile" },
];

function MainNav(): JSX.Element {
  const me = useMe();
  const { path } = useLocation();
  const link = (href: string, name: string): JSX.Element => (
    <Link href={href} aria-current={path === href || (href !== "/" && path.startsWith(`${href}/`)) ? "page" : undefined}>
      {name}
    </Link>
  );
  return (
    <nav class="main-nav" aria-label="Main">
      {link("/", "Seam")}
      {LINKS.map(({ href, name }) => link(href, name))}
      {me ? (
        <button
          type="button"
          class="nav-button"
          onClick={() => {
            void signOut().then(() => navigate("/"));
          }}
        >
          Sign out
        </button>
      ) : (
        <>
          {link("/signin", "Sign in")}
          {link("/signup", "Create account")}
        </>
      )}
    </nav>
  );
}

function EmailConfirmation(): JSX.Element | null {
  const me = useMe();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!me || me.verified) return null;
  const resend = (): void => {
    if (pending) return;
    setPending(true);
    setNotice(null);
    post("/api/auth/verify/resend").then(
      () => announce("A new confirmation email is on its way."),
      (error: unknown) => {
        if (error instanceof ApiFailure && error.code === "ALREADY_VERIFIED") {
          setMe({ ...me, verified: true });
          return;
        }
        const sentence = error instanceof ApiFailure && error.code === "MAIL_UNAVAILABLE" ? "We couldn't send email right now. Try again in a minute." : M56;
        setNotice(sentence);
        announce(sentence);
      },
    ).finally(() => setPending(false));
  };
  return (
    <section class="banner" aria-label="Email confirmation">
      <p>Confirm your email to join duels and the leaderboard.</p>
      <button type="button" class="button" aria-disabled={pending ? "true" : "false"} onClick={resend}>
        Send again
      </button>
      {notice && <p class="form-note">{notice}</p>}
    </section>
  );
}

interface ShellProps {
  navigation: "top" | "bottom";
  children: ComponentChildren;
}

export function Shell({ navigation, children }: ShellProps): JSX.Element {
  return (
    <div class={`page nav-${navigation}`}>
      {navigation === "top" && <MainNav />}
      <EmailConfirmation />
      <main id="main">{children}</main>
      {navigation === "bottom" && <MainNav />}
    </div>
  );
}
