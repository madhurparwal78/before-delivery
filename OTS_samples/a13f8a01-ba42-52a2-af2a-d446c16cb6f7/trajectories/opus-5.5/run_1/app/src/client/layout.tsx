import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import type { Pen } from "../shared/types";
import { api } from "./api";
import { Dialog } from "./components";
import { useBand } from "./hooks";
import { refreshLive } from "./live";
import { Link, navigate } from "./router";
import { markVerificationPending, setState, useAppState, verificationPending } from "./store";

export async function startPen(): Promise<void> {
  const result = await api<Pen>("POST", "/api/pens", {});
  if (result.ok) navigate(`/pen/${result.data.id}`);
}

async function signOut(): Promise<void> {
  await api("POST", "/api/signout");
  setState({ user: null, accountStatus: "" });
  refreshLive();
  navigate("/");
}

function HeaderLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAppState();
  const close = () => onNavigate?.();
  return (
    <>
      {user && (
        <Link href="/dashboard" onClick={close}>
          Dashboard
        </Link>
      )}
      <Link href="/explore" onClick={close}>
        Explore
      </Link>
      <Link href={user ? "/collections" : "/signin"} onClick={close}>
        Collections
      </Link>
      <Link href="/shelf" onClick={close}>
        The shelf
      </Link>
      {!user && (
        <Link href="/signin" onClick={close}>
          Sign in
        </Link>
      )}
    </>
  );
}

function StartPenControl() {
  const { user } = useAppState();
  if (!user) {
    return (
      <Link href="/signup" class="button primary">
        Start a pen
      </Link>
    );
  }
  return (
    <button type="button" class="primary" onClick={() => void startPen()}>
      Start a pen
    </button>
  );
}

export function Header({ inverse = false }: { inverse?: boolean }) {
  const { user } = useAppState();
  const band = useBand();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
    <header class={`site-header${inverse ? " inverse" : ""}`}>
      {!inverse && band !== "narrow" && (
        <Link href={user ? "/dashboard" : "/"} class="wordmark-link">
          ashlar
        </Link>
      )}
      {band === "narrow" ? (
        <nav class="header-actions" aria-label="Site">
          <button type="button" ref={menuButton} aria-expanded={menuOpen ? "true" : "false"} onClick={() => setMenuOpen(true)}>
            Menu
          </button>
          <StartPenControl />
        </nav>
      ) : (
        <nav class="header-actions" aria-label="Site">
          <HeaderLinks />
          <StartPenControl />
          {user && (
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          )}
        </nav>
      )}
      {menuOpen && band === "narrow" && (
        <Dialog label="Menu" onClose={() => setMenuOpen(false)} returnFocus={() => menuButton.current} class="menu-dialog">
          <div class="menu-links">
            <HeaderLinks onNavigate={() => setMenuOpen(false)} />
            {user && (
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            )}
            <button type="button" onClick={() => setMenuOpen(false)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </header>
  );
}

export function AccountNotices() {
  const { user, accountStatus } = useAppState();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const resend = async () => {
    setBusy(true);
    const result = await api<{ verification: string }>("POST", "/api/verify/resend");
    setBusy(false);
    if (result.ok) {
      markVerificationPending(user.id, false);
      setState({ accountStatus: `Sent a new link to ${user.email}.` });
    } else if (result.error.error === "already_verified") {
      setState({ user: { ...user, verified: true }, accountStatus: "Email verified. You can now save versions." });
    } else {
      setState({ accountStatus: "Mail is unreachable, so the link was not sent. Try Resend link again in a moment." });
    }
  };
  return (
    <div class="account-notices">
      {!user.verified && (
        <section role="region" aria-label="Verify your email" class="state-panel verify-banner">
          <p>
            {verificationPending(user.id)
              ? "Your account is ready, but the verification email is not sent yet. Use Resend link in a moment."
              : `Check ${user.email} for a link to verify your account. Until then you can write and preview, but not save versions, publish, like or fork.`}
          </p>
          <button type="button" onClick={() => void resend()} disabled={busy}>
            Resend link
          </button>
        </section>
      )}
      <p role="status" aria-label="Account status" class="account-status">
        {accountStatus}
      </p>
    </div>
  );
}

export function Page(props: { children: ComponentChildren; class?: string }) {
  return (
    <>
      <Header />
      <AccountNotices />
      <main class={props.class}>{props.children}</main>
    </>
  );
}
