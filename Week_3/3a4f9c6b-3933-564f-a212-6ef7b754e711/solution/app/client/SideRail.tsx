// The left rail: projects, the selected project's stages, Windows and freezes, the person and Sign out.
import { LogOut } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import type { Role, SessionBody } from "../shared/api";
import { call } from "./api";
import { navigate } from "./hooks";

const ROLE_WORDS: Record<Role, string> = {
  platform_engineer: "Platform engineer",
  service_developer: "Service developer",
  release_manager: "Release manager",
  oncall_sre: "On-call SRE",
};

export function SideRail({ session, slug, stages, selected, onStage, focusFirst }: {
  session: SessionBody; slug: string; stages: string[]; selected?: string | null; onStage?: (stage: string) => void; focusFirst?: boolean;
}) {
  const [projects, setProjects] = useState<{ slug: string; name: string; role: Role }[]>([]);
  const [first, setFirst] = useState<HTMLAnchorElement | null>(null);
  useEffect(() => {
    void call<{ projects: { slug: string; name: string; role: Role }[] }>("GET", "/api/projects").then((r) => r.ok && setProjects(r.data.projects));
  }, []);
  useEffect(() => {
    if (focusFirst) first?.focus();
  }, [focusFirst, first]);
  const go = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
    event.preventDefault();
    navigate(to);
  };
  const role = session.memberships.find((m) => m.project === slug)?.role;
  const signOut = async () => {
    await call("DELETE", "/api/session", { guest: true });
    // A full load drops every piece of the signed-in state.
    location.assign("/sign-in");
  };
  return (
    <div className="side-rail">
      <div className="brand">
        <span className="brand-name">Keelson</span>
        <span className="brand-maker">Tideline Works</span>
      </div>
      <nav aria-label="Projects" className="rail-nav">
        <ul>
          {projects.map((p, i) => (
            <li key={p.slug}>
              <a ref={i === 0 ? setFirst : undefined} href={`/projects/${p.slug}`} aria-current={p.slug === slug ? "page" : undefined}
                onClick={(event) => go(event, `/projects/${p.slug}`)}>{p.name}</a>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Stages" className="rail-nav rail-stages">
        <ul>
          {stages.map((stage) => (
            <li key={stage}>
              <a href={`/projects/${slug}?stage=${encodeURIComponent(stage)}`} aria-current={stage === selected ? "true" : undefined} onClick={(event) => {
                event.preventDefault();
                if (onStage) onStage(stage);
                else navigate(`/projects/${slug}?stage=${encodeURIComponent(stage)}`);
              }}>{stage}</a>
            </li>
          ))}
        </ul>
      </nav>
      <a className="rail-link" href={`/projects/${slug}/windows`} onClick={(event) => go(event, `/projects/${slug}/windows`)}>Windows and freezes</a>
      <div className="rail-person">
        <span className="rail-person-name">{session.user.name}</span>
        <span className="rail-person-role">{role ? ROLE_WORDS[role] : ""}</span>
        <button type="button" className="button quiet" onClick={() => void signOut()}><LogOut aria-hidden="true" size={16} /> Sign out</button>
      </div>
    </div>
  );
}
