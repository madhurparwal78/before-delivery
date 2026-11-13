import type { ReactNode } from "react";
import { api } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useMe } from "../lib/session";
import { Status } from "./Regions";

const LINKS = [
  { to: "/documents", label: "Documents" },
  { to: "/templates", label: "Templates" },
  { to: "/team", label: "Team" },
];

export function AppFrame({ children }: { children: ReactNode }) {
  const me = useMe();
  const { path } = useRouter();
  const signOut = async () => {
    await api.del("/api/session");
    window.location.assign("/sign-in");
  };
  return (
    <>
      <header className="topbar">
        <span className="brand">Undersign</span>
        <nav aria-label="Main" className="mainnav">
          {LINKS.map((item) => (
            <Link key={item.to} to={item.to} aria-current={path.startsWith(item.to) ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <button type="button" className="btn quiet signout" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <Status label="Account notice" className="banner-stack account">
        {me.notice ? <p className="banner">{me.notice}</p> : null}
      </Status>
      <main className="page">{children}</main>
    </>
  );
}
