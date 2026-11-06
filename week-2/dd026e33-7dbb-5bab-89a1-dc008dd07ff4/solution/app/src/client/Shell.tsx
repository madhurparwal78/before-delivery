// App shell (brief: Screens and layout › App shell): house and product name, the role's navigation
// (folded behind Menu below 768 px), Units, Sign out and, on staff screens, the service notice.
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { ServiceStatus } from "../shared/api.js";
import { HOUSE_NAME, type Role } from "../shared/domain.js";
import type { DistanceUnit, FilmUnit, PressureUnit, Units } from "../shared/units.js";
import { HttpError, Interrupted, NoAnswer, fieldErrors, request } from "./api.js";
import { useTwoPanes } from "./hooks.js";
import { SIGNED_IN_AGAIN } from "./labels.js";
import { navigate, useLocation } from "./router.js";
import { useSession } from "./session.js";
import { Dialog } from "./ui/Dialog.js";
import { StatusRegion, useNote } from "./ui/Feedback.js";
import { Icon } from "./ui/Icon.js";

const NAVIGATION: Record<Role, { label: string; to: string }[]> = {
  concierge: [
    { label: "Bays", to: "/bays" },
    { label: "Releases", to: "/releases" },
  ],
  care_technician: [{ label: "Care round", to: "/round" }],
  workshop_lead: [{ label: "Jobs", to: "/jobs" }],
  house_manager: [
    { label: "Board", to: "/board" },
    { label: "Bays", to: "/bays" },
    { label: "Care round", to: "/round" },
    { label: "Jobs", to: "/jobs" },
    { label: "Releases", to: "/releases" },
    { label: "Staff access", to: "/staff" },
  ],
  owner: [{ label: "My cars", to: "/portal" }],
};

const NOTICES: Record<keyof ServiceStatus, string> = {
  storage:
    "Photo storage is unreachable. Photos and condition reports can't be uploaded right now; bays, belongings and care rounds still work.",
  billing: "Billing is unreachable. Invoices can't be issued or paid right now; bay billing will catch up when it's back.",
  mail: "Email is unreachable. Owner emails are queued, and releases can't be completed until it's back.",
};

/** A same-origin link that changes screens without a reload. */
export function Link({ to, children, className, onFollow }: { to: string; children: ReactNode; className?: string; onFollow?: () => void }): JSX.Element {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onFollow?.();
    navigate(to);
  };
  return (
    <a href={to} className={className} onClick={follow}>
      {children}
    </a>
  );
}

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useSession();
  const wide = useTwoPanes();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [settings, saySettings] = useNote();
  const menuButton = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const showLinks = wide || menuOpen;

  useEffect(() => {
    if (menuOpen) navRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (wide) setMenuOpen(false);
  }, [wide]);

  const signOut = async (): Promise<void> => {
    try {
      await request("/api/session", { method: "DELETE" });
    } finally {
      navigate("/sign-in");
    }
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-house">{HOUSE_NAME}</span>
          <span className="brand-product">Lacquer</span>
        </div>
        {wide ? null : (
          <button
            ref={menuButton}
            type="button"
            className="button icon-button"
            aria-expanded={menuOpen}
            aria-controls="main-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? "close" : "menu"} />
            <span className="compact-label">Menu</span>
          </button>
        )}
        <nav
          id="main-navigation"
          ref={navRef}
          aria-label="Main"
          className={wide ? "nav" : menuOpen ? "nav nav-open" : "nav nav-closed"}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !wide) {
              setMenuOpen(false);
              menuButton.current?.focus();
            }
          }}
        >
          {showLinks ? (
            <ul>
              {NAVIGATION[user.role].map((item) => (
                <li key={item.to}>
                  <Link to={item.to} onFollow={() => setMenuOpen(false)} className={location.path.startsWith(item.to) ? "nav-link current" : "nav-link"}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </nav>
        <div className="topbar-actions">
          <button type="button" className="button icon-button" onClick={() => setUnitsOpen(true)}>
            <Icon name="ruler" />
            <span className="compact-label">Units</span>
          </button>
          <button type="button" className="button icon-button" onClick={() => void signOut()}>
            <Icon name="signOut" />
            <span className="compact-label">Sign out</span>
          </button>
        </div>
      </header>
      {user.role === "owner" ? null : <ServiceNotice />}
      <StatusRegion name="Settings updates" note={settings} className="shell-status" />
      <main className="page">{children}</main>
      {unitsOpen ? <UnitsDialog onClose={() => setUnitsOpen(false)} say={saySettings} /> : null}
    </>
  );
}

function ServiceNotice(): JSX.Element {
  const [down, setDown] = useState<(keyof ServiceStatus)[]>([]);
  useEffect(() => {
    let live = true;
    const check = (): void => {
      fetch("/api/status", { credentials: "same-origin" })
        .then((response) => (response.ok ? (response.json() as Promise<ServiceStatus>) : null))
        .then((status) => {
          if (!live || !status) return;
          const next = (Object.keys(NOTICES) as (keyof ServiceStatus)[]).filter((service) => status[service] === "down");
          setDown((previous) => (previous.join() === next.join() ? previous : next));
        })
        .catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);
  return (
    <div role="status" aria-label="Service notice" className={down.length ? "service-notice" : "service-notice empty"}>
      {down.map((service) => (
        <p key={service}>
          <Icon name="alert" />
          {NOTICES[service]}
        </p>
      ))}
    </div>
  );
}

const UNIT_GROUPS = [
  { key: "film", label: "Film build", options: [["um", "µm"], ["mil", "mil"]] },
  { key: "pressure", label: "Tyre pressure", options: [["bar", "bar"], ["psi", "psi"]] },
  { key: "distance", label: "Distance", options: [["km", "km"], ["mi", "mi"]] },
] as const;

function UnitsDialog({ onClose, say }: { onClose: () => void; say: (text: string, tone?: "info" | "error") => void }): JSX.Element {
  const { units, setUnits } = useSession();
  const [choice, setChoice] = useState<Units>(units);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async (): Promise<void> => {
    say("Saving units...");
    try {
      const answer = await request<{ units: Units }>("/api/me/units", { method: "PUT", body: choice });
      setUnits(answer.data.units);
      onClose();
      say("Units updated.");
    } catch (error) {
      if (error instanceof Interrupted) say(SIGNED_IN_AGAIN);
      else if (error instanceof HttpError && error.status === 422) {
        setErrors(fieldErrors(error));
        say(Object.values(fieldErrors(error))[0] ?? "", "error");
      } else if (error instanceof NoAnswer) say("No answer from the server. Press Save units again.", "error");
    }
  };

  const pick = (key: keyof Units, value: string): void => {
    if (key === "film") setChoice({ ...choice, film: value as FilmUnit });
    if (key === "pressure") setChoice({ ...choice, pressure: value as PressureUnit });
    if (key === "distance") setChoice({ ...choice, distance: value as DistanceUnit });
  };

  return (
    <Dialog title="Units" onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {UNIT_GROUPS.map((group) => (
          <div key={group.key} role="radiogroup" aria-label={group.label} className="radio-group">
            <p className="radio-group-label">{group.label}</p>
            <div className="radio-options">
              {group.options.map(([value, label]) => (
                <label key={value} className="radio">
                  <input
                    type="radio"
                    name={group.key}
                    value={value}
                    checked={choice[group.key] === value}
                    onChange={() => pick(group.key, value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {errors[group.key] ? <p className="field-error">{errors[group.key]}</p> : null}
          </div>
        ))}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Save units
          </button>
        </div>
      </form>
    </Dialog>
  );
}
