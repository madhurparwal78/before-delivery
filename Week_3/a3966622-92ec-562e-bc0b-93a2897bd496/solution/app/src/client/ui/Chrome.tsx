// The top strip on every screen: product name, signed-in role, server port time and service state.
import type { ReactNode } from "react";
import { clockText, portMinuteOfDay } from "../../shared/portTime";
import type { ServiceName } from "../../shared/types";
import { useServerNow } from "../clock";
import { useSession } from "../session";
import { ROLE_NAMES } from "./format";

const SERVICES: { name: ServiceName; label: string; outage: string }[] = [
  { name: "billing", label: "Billing", outage: "Billing provider unreachable - charges and invoices are pending and will post automatically." },
  { name: "storage", label: "Storage", outage: "Evidence store unreachable - photo uploads are paused until it returns." },
  { name: "mail", label: "Mail", outage: "Mail service unreachable - notices are pending and will send automatically." },
];

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M2 8h20M4 8v3M8 8v6M12 8v9M16 8v5M20 8v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
      <path d="M2 20c3-2 6-2 10 0s7 2 10 0" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PortClock() {
  const now = useServerNow(1000);
  return (
    <p className="strip-clock">
      <span className="num">{now === null ? "--:--" : clockText(portMinuteOfDay(now))}</span> port time
    </p>
  );
}

export function TopStrip() {
  const { user, services, signOut } = useSession();
  return (
    <header className="strip">
      <p className="brand">
        <Mark />
        <span className="brand-name">Slackwater</span>
        <span className="brand-sub">Ebbstone Marine · Port Ansell</span>
      </p>
      {user ? <p className="strip-role">{ROLE_NAMES[user.role]}</p> : null}
      <PortClock />
      {user ? (
        <>
          <section className="services" aria-label="Service state">
            {services
              ? SERVICES.map((s) => (
                  <span key={s.name} className="service" data-state={services[s.name]}>
                    {s.label} {services[s.name]}
                  </span>
                ))
              : null}
          </section>
          <button type="button" className="ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </>
      ) : null}
    </header>
  );
}

function ServiceAnnouncements() {
  const { services } = useSession();
  const lines = SERVICES.filter((s) => services?.[s.name] === "down").map((s) => s.outage);
  return (
    <div role="status" aria-label="Service announcements" aria-live="polite" className={lines.length ? "outages" : "outages empty"}>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "app app-board" : "app"}>
      <TopStrip />
      <ServiceAnnouncements />
      <main id="main" className={wide ? "main wide" : "main"}>
        {children}
      </main>
    </div>
  );
}
