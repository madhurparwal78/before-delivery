/**
 * The header, footer, lighting dial and comparison tray that every page shares.
 *
 * Closed panels render nothing: the mega-menu, the Menu dialog and the tray's
 * contents are not visible, focusable or in the accessibility tree while closed.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api.js";
import { BRAND, FAMILY_LINKS, NEWSLETTER, NEWSLETTER_OCCUPATION_OPTIONS } from "../../shared/copy.js";
import { isValidEmail } from "../../shared/domain.js";
import { LIGHTING_STATES } from "../../shared/copy.js";
import type { DialMode } from "../../shared/types.js";
import { useBreakpoint, useCart, useRouter, useSession, useTray } from "../state/app.js";
import { Dialog } from "./Dialog.js";

export function AppLink({
  to,
  children,
  className,
  ...rest
}: { to: string; children: ReactNode; className?: string } & Record<string, unknown>) {
  const { navigate, path } = useRouter();
  const target = new URL(to, window.location.origin);
  return (
    <a
      href={to}
      className={className}
      aria-current={target.pathname === path ? "page" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

function AccountLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { user, setUser } = useSession();
  const { navigate } = useRouter();

  const signOut = useCallback(async () => {
    await api.signout().catch(() => undefined);
    setUser(null);
    onNavigate?.();
    navigate("/");
  }, [navigate, setUser, onNavigate]);

  if (!user) {
    return (
      <>
        <AppLink to="/signin" className="nav-link" onClick={onNavigate}>
          Sign in
        </AppLink>
        <AppLink to="/signup" className="nav-link">
          Sign up
        </AppLink>
      </>
    );
  }

  return (
    <>
      <AppLink to="/account" className="nav-link">
        Account
      </AppLink>
      <button type="button" className="button button-quiet" onClick={() => void signOut()}>
        Sign out
      </button>
    </>
  );
}

export function Header() {
  const { user } = useSession();
  const { count } = useCart();
  const breakpoint = useBreakpoint();
  const [megaOpen, setMegaOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const catalogueButtonRef = useRef<HTMLButtonElement | null>(null);
  const megaRef = useRef<HTMLDivElement | null>(null);
  const megaId = useId();

  const isApprovedTrade = user?.role === "trade" && user.trade_status === "approved";

  const closeMega = useCallback(
    (returnFocus: boolean) => {
      setMegaOpen(false);
      if (returnFocus) catalogueButtonRef.current?.focus();
    },
    [],
  );

  // Escape or a click outside closes the mega-menu and returns focus to "Catalogue".
  useEffect(() => {
    if (!megaOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (megaRef.current?.contains(target) || catalogueButtonRef.current?.contains(target)) return;
      closeMega(true);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeMega(true);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [megaOpen, closeMega]);

  const familyLinks = FAMILY_LINKS.map((family) => (
    <li key={family.slug}>
      <AppLink to={`/catalogue?family=${family.slug}`} onClick={() => closeMega(false)}>
        {family.label}
      </AppLink>
    </li>
  ));

  return (
    <header className="header">
      <div className="wrap header-inner">
        <AppLink to="/" className="wordmark">
          {BRAND.wordmark}
        </AppLink>

        <nav aria-label="Main">
          {breakpoint === "phone" ? (
            <button type="button" className="button button-quiet" onClick={() => setMenuOpen(true)}>
              Menu
            </button>
          ) : (
            <button
              type="button"
              className="button button-quiet"
              ref={catalogueButtonRef}
              aria-expanded={megaOpen}
              aria-controls={megaId}
              onClick={() => setMegaOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setMegaOpen(true);
                  // Down Arrow opens the menu and focuses its first link.
                  requestAnimationFrame(() => megaRef.current?.querySelector("a")?.focus());
                }
              }}
            >
              Catalogue
            </button>
          )}

          {breakpoint !== "phone" && (
            <>
              <AppLink to="/favourites" className="nav-link">
                Favourites
              </AppLink>
              {isApprovedTrade && (
                <AppLink to="/projects" className="nav-link">
                  Projects
                </AppLink>
              )}
              {user?.role === "admin" && (
                <AppLink to="/admin" className="nav-link">
                  Admin
                </AppLink>
              )}
            </>
          )}

          <AppLink to="/cart" className="nav-link">
            Cart
          </AppLink>
          <span className="small muted numeric" aria-hidden="true">
            {count}
          </span>
          <span className="visually-hidden">{`${count} items in cart`}</span>

          {breakpoint !== "phone" && <AccountLinks />}
        </nav>
      </div>

      {megaOpen && breakpoint !== "phone" && (
        <div className="mega" id={megaId} role="region" aria-label="Catalogue menu" ref={megaRef}>
          <div className="wrap">
            <ul>{familyLinks}</ul>
          </div>
        </div>
      )}

      {menuOpen && (
        <Dialog title="Menu" variant="full" onClose={() => setMenuOpen(false)}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }} className="stack">
            {FAMILY_LINKS.map((family) => (
              <li key={family.slug}>
                <AppLink to={`/catalogue?family=${family.slug}`} onClick={() => setMenuOpen(false)}>
                  {family.label}
                </AppLink>
              </li>
            ))}
            <li>
              <AppLink to="/favourites" onClick={() => setMenuOpen(false)}>
                Favourites
              </AppLink>
            </li>
            {isApprovedTrade && (
              <li>
                <AppLink to="/projects" onClick={() => setMenuOpen(false)}>
                  Projects
                </AppLink>
              </li>
            )}
            {user?.role === "admin" && (
              <li>
                <AppLink to="/admin" onClick={() => setMenuOpen(false)}>
                  Admin
                </AppLink>
              </li>
            )}
          </ul>
          <div className="row" style={{ marginTop: 16 }}>
            <AccountLinks onNavigate={() => setMenuOpen(false)} />
          </div>
        </Dialog>
      )}
    </header>
  );
}

export function LightingDial() {
  const { dialMode, setDialMode } = useSession();
  return (
    <div className="dial">
      <fieldset role="radiogroup" aria-label="Lighting">
        <legend>Lighting</legend>
        {LIGHTING_STATES.map((state) => (
          <label className="chip" key={state.value}>
            <input
              type="radio"
              name="lighting"
              value={state.value}
              checked={dialMode === state.value}
              onChange={() => setDialMode(state.value as DialMode)}
            />
            <span>{state.label}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/**
 * Publishes a fixed bar's height as a CSS variable, so the bars above it can sit
 * clear of it: the tray clears the quick-add bar and the dial clears the tray.
 */
export function usePublishedHeight(name: string): (element: HTMLDivElement | null) => void {
  const observerRef = useRef<ResizeObserver | null>(null);
  return useCallback(
    (element: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      if (!element) {
        document.documentElement.style.setProperty(name, "0px");
        return;
      }
      const publish = (): void =>
        document.documentElement.style.setProperty(name, `${Math.round(element.offsetHeight)}px`);
      publish();
      observerRef.current = new ResizeObserver(publish);
      observerRef.current.observe(element);
    },
    [name],
  );
}

export function CompareTray() {
  const { entries, status, remove } = useTray();
  const [open, setOpen] = useState(false);
  const trayId = useId();
  const measure = usePublishedHeight("--tray-height");

  return (
    <div className="tray" ref={measure}>
      <div className="wrap tray-inner">
        <button
          type="button"
          className="button button-quiet"
          aria-expanded={open}
          aria-controls={trayId}
          onClick={() => setOpen((current) => !current)}
        >
          {`Compare (${entries.length})`}
        </button>

        {open && (
          <div className="row" id={trayId} role="region" aria-label="Compare tray">
            {entries.length === 0 ? (
              <span className="small muted">No fittings chosen yet.</span>
            ) : (
              <>
                {entries.map((entry) => (
                  <span className="row" key={entry.code}>
                    <span className="small numeric">{entry.code}</span>
                    <button
                      type="button"
                      className="button button-quiet small"
                      onClick={() => remove(entry.code)}
                    >
                      {`Remove ${entry.productName} from comparison`}
                    </button>
                  </span>
                ))}
                <AppLink
                  to={`/compare?codes=${entries.map((entry) => entry.code).join(",")}`}
                  className="button"
                >
                  Open comparison
                </AppLink>
              </>
            )}
          </div>
        )}

        <span className="small muted" aria-live="polite">
          {status}
        </span>
      </div>
    </div>
  );
}

export function Footer() {
  const [email, setEmail] = useState("");
  const [occupation, setOccupation] = useState("architect");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!consent) {
        setStatus(NEWSLETTER.consentRequired);
        return;
      }
      if (!isValidEmail(email)) {
        setStatus(NEWSLETTER.emailInvalid);
        return;
      }
      setSending(true);
      try {
        await api.newsletter({ email: email.trim(), occupation, consent: true });
        setStatus(NEWSLETTER.pending(email.trim()));
        setEmail("");
        setConsent(false);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        setStatus(error.field("consent") ? NEWSLETTER.consentRequired : NEWSLETTER.emailInvalid);
      } finally {
        setSending(false);
      }
    },
    [consent, email, occupation],
  );

  return (
    <footer className="footer">
      <div className="wrap">
        <section aria-label="Newsletter">
          <h2>Lightfall newsletter</h2>
          <form className="newsletter-form" onSubmit={(event) => void submit(event)} noValidate>
            <div className="field">
              <label htmlFor="newsletter-email">Email</label>
              <input
                id="newsletter-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="newsletter-occupation">Occupation</label>
              <select
                id="newsletter-occupation"
                value={occupation}
                onChange={(event) => setOccupation(event.target.value)}
              >
                {NEWSLETTER_OCCUPATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="consent">
              <input
                id="newsletter-consent"
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <label htmlFor="newsletter-consent">{NEWSLETTER.consentLabel}</label>
            </div>
            <div className="submit">
              <button type="submit" className="button button-primary" disabled={sending}>
                {sending ? NEWSLETTER.subscribing : "Subscribe"}
              </button>
            </div>
          </form>
          <p role="status" aria-label="Newsletter status" className="small">
            {status}
          </p>
        </section>

        <hr className="hairline" style={{ margin: "20px 0" }} />
        <p className="small muted">{BRAND.footerLine}</p>
      </div>
    </footer>
  );
}
