import { useState, type ReactNode } from "react";
import type { Pen } from "../../shared/types.js";
import { api } from "../api.js";
import { useAccount } from "../account.js";
import { Link, navigate, usePath } from "../router.js";
import { useBand } from "../use-media.js";
import { useDialog } from "../use-dialog.js";
import { Icon } from "./icons.js";

const BANNER_SENT = "Check {email} for a link to verify your account. Until then you can write and preview, but not save versions, publish, like or fork.";
const BANNER_PENDING = "Your account is ready, but the verification email is not sent yet. Use Resend link in a moment.";

function StartPen({ className }: { className: string }): React.JSX.Element {
  const { user } = useAccount();
  const [busy, setBusy] = useState(false);
  if (user === null) {
    return (
      <Link to="/signup" className={className}>
        Start a pen
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      aria-busy={busy}
      onClick={() => {
        setBusy(true);
        void api
          .post<Pen>("/api/pens")
          .then((pen) => navigate(`/pen/${pen.id}`))
          .finally(() => setBusy(false));
      }}
    >
      Start a pen
    </button>
  );
}

function NavLinks({ onFollow }: { onFollow?: () => void }): React.JSX.Element {
  const { user, signOut } = useAccount();
  const path = usePath();
  const link = (to: string, label: string): React.JSX.Element => (
    <Link to={to} className="nav-link" aria-current={path === to ? "page" : undefined} onClick={onFollow}>
      {label}
    </Link>
  );
  return (
    <>
      {user && link("/dashboard", "Dashboard")}
      {link("/explore", "Explore")}
      {link(user ? "/collections" : "/signin", "Collections")}
      {link("/shelf", "The shelf")}
      {user === null && link("/signin", "Sign in")}
      {user && (
        <button
          type="button"
          className="nav-link nav-button"
          onClick={() => {
            onFollow?.();
            void signOut();
          }}
        >
          Sign out
        </button>
      )}
    </>
  );
}

function SiteHeader({ landing = false }: { landing?: boolean }): React.JSX.Element {
  const band = useBand();
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useDialog(menuOpen, () => setMenuOpen(false), () => null);
  const { user } = useAccount();

  return (
    <header className="site-header" data-landing={landing}>
      {!landing && band !== "narrow" && (
        <Link to="/" className="brand">
          ashlar
        </Link>
      )}
      {band === "narrow" ? (
        <>
          <button type="button" className="nav-link nav-button menu-button" onClick={() => setMenuOpen(true)} aria-haspopup="dialog">
            <Icon name="menu" />
            Menu
          </button>
          <StartPen className="button primary" />
          <dialog ref={menu.ref} aria-label="Menu" className="menu-dialog" {...menu.props}>
            <nav aria-label="Site">
              <NavLinks onFollow={() => setMenuOpen(false)} />
            </nav>
            <button type="button" className="button" onClick={() => setMenuOpen(false)}>
              Close
            </button>
          </dialog>
        </>
      ) : (
        <nav aria-label="Site" className="site-nav" data-signed-in={user !== null}>
          <NavLinks />
          <StartPen className="button primary" />
        </nav>
      )}
    </header>
  );
}

function VerifyBanner(): React.JSX.Element {
  const { user, verification, resend } = useAccount();
  const [busy, setBusy] = useState(false);
  const copy = verification === "pending" ? BANNER_PENDING : BANNER_SENT.replace("{email}", user?.email ?? "");
  return (
    <section aria-label="Verify your email" className="banner">
      <p>{copy}</p>
      <button
        type="button"
        className="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          setBusy(true);
          void resend().finally(() => setBusy(false));
        }}
      >
        Resend link
      </button>
    </section>
  );
}

export function Shell({ children, landing = false }: { children: ReactNode; landing?: boolean }): React.JSX.Element {
  const { user, message } = useAccount();
  const unverified = user !== null && !user.verified;
  return (
    <>
      <SiteHeader landing={landing} />
      {unverified && <VerifyBanner />}
      {user !== null && (unverified || message !== "") && (
        <p role="status" aria-label="Account status" className="account-status">
          {message}
        </p>
      )}
      <main>{children}</main>
    </>
  );
}
