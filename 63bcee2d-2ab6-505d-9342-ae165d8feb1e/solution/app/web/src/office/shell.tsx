import { useEffect, type ReactNode } from "react";
import { del } from "../api";
import { linkClick, navigate, useLocation } from "../router";
import { ACCESS_REMOVED } from "./copy";
import { useOffice, type Role } from "./context";

// The office frame: skip link, header with the Workspace navigation and Sign out, the two live regions,
// and the main content. Signed-in pages send a signed-out visitor to sign-in.

const NAV: { href: string; label: string; roles: Role[] | "all" }[] = [
  { href: "/office", label: "Rollouts", roles: "all" },
  { href: "/office/members", label: "Members", roles: "all" },
  { href: "/office/case-studies", label: "Case studies", roles: ["director"] },
  { href: "/office/enquiries", label: "Enquiries", roles: ["director"] },
];

export function OfficeShell({ children, signedIn = true, title }: { children: ReactNode; signedIn?: boolean; title: string }) {
  const office = useOffice();
  const location = useLocation();

  useEffect(() => {
    document.title = `${title} · Plumbline`;
  }, [title]);

  useEffect(() => {
    if (signedIn && !office.loading && !office.member && !office.removed) {
      navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    }
  }, [signedIn, office.loading, office.member, office.removed, location.pathname, location.search]);

  const signOut = async (): Promise<void> => {
    await del("/api/session");
    await office.refreshSession();
    navigate("/sign-in");
  };

  const member = office.member;
  const nav = member ? NAV.filter((item) => item.roles === "all" || item.roles.includes(member.role)) : [];
  let content: ReactNode = children;
  if (signedIn && office.removed) {
    content = (
      <section className="panel panel-body removed-notice">
        <h1>Access removed</h1>
        <p>{ACCESS_REMOVED}</p>
      </section>
    );
  } else if (signedIn && !member) {
    content = <p className="loading-line">Loading…</p>;
  }

  return (
    <>
      <a className="skip-link" href="#content" onClick={(event) => {
        event.preventDefault();
        document.getElementById("content")?.focus();
      }}>Skip to content</a>
      <header className="office-header">
        <a className="office-brand" href={member ? "/office" : "/sign-in"} onClick={(event) => linkClick(event, member ? "/office" : "/sign-in")}>
          Plumbline <small>Marrow Hall Interiors</small>
        </a>
        {member && !office.removed && (
          <nav className="office-nav" aria-label="Workspace">
            <ul>
              {nav.map((item) => (
                <li key={item.href}>
                  <a href={item.href} aria-current={location.pathname === item.href ? "page" : undefined}
                    onClick={(event) => linkClick(event, item.href)}>{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {member && (
          <div className="who">
            <span>{member.name}, {member.organisation}</span>
            <button type="button" className="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        )}
      </header>
      <div className="notices">
        <p className="notice notice-status" role="status" aria-live="polite" aria-label="Announcements">{office.status}</p>
        <p className="notice notice-alert" role="alert" aria-live="assertive" aria-label="Problems">{office.problem}</p>
      </div>
      <main id="content" className="office-main" tabIndex={-1}>{content}</main>
    </>
  );
}
