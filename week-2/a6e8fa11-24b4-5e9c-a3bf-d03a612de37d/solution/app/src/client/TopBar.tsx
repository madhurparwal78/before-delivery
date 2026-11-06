// Top bar and service banner, on every signed-in screen.
import { useEffect, useState } from "react";
import { api } from "./api.js";
import { COPY, ROLE_LABEL } from "./copy.js";
import { Link, navigate } from "./router.js";
import { useSession } from "./session.js";
import { type ServiceStatus } from "./types.js";
import { Icon, Mark } from "./ui/Icon.js";

export function TopBar(): JSX.Element {
  const { user, setUser } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const signOut = async (): Promise<void> => {
    await api.del("/api/session").catch(() => undefined);
    setUser(null);
    navigate("/signin");
  };
  const manager = user.role === "data_manager";
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <Link href="/" className="mark" aria-label="Furrowbook">
          <Mark />
          <span className="mark-word" aria-hidden="true">
            Furrowbook
          </span>
        </Link>
        <span className="station-name">{user.stationName}</span>
      </div>
      <button type="button" className="btn btn-icon menu-toggle" aria-expanded={menuOpen} aria-controls="topbar-menu" onClick={() => setMenuOpen((o) => !o)}>
        <Icon name="menu" />
        <span>Menu</span>
      </button>
      <div id="topbar-menu" className={`topbar-menu${menuOpen ? " open" : ""}`}>
        <nav className="topbar-links" aria-label="Main">
          <Link href="/" onClick={() => setMenuOpen(false)}>
            Workbooks
          </Link>
          {manager && (
            <Link href="/station" onClick={() => setMenuOpen(false)}>
              Station
            </Link>
          )}
        </nav>
        <p className="who">
          <span className="who-name">{user.name}</span>
          <span className="who-role">{ROLE_LABEL[user.role]}</span>
        </p>
        <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>
          <Icon name="signOut" />
          Sign out
        </button>
      </div>
    </header>
  );
}

/** Read on load and every 10 seconds, so it reflects an outage within 20 seconds. */
export function ServiceBanner(): JSX.Element {
  const [status, setStatus] = useState<ServiceStatus>({ storage: "up", mail: "up" });
  useEffect(() => {
    let live = true;
    const read = (): void => {
      api
        .get<ServiceStatus>("/api/status")
        .then((s) => live && setStatus(s))
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const lines = [status.storage === "down" ? COPY.storageBanner : null, status.mail === "down" ? COPY.mailBanner : null].filter(Boolean);
  return (
    <div className={`service-banner${lines.length ? " shown" : ""}`} role="status" aria-label="Service status">
      {lines.map((line) => (
        <p key={line}>
          <Icon name="alert" />
          <span>{line}</span>
        </p>
      ))}
    </div>
  );
}
