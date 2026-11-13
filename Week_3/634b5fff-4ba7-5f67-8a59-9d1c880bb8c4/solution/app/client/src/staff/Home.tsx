import { Link } from "../router.js";
import type { Role } from "../../../shared/domain.js";
import type { Me } from "./types.js";
import { SignOut } from "./Nav.js";
import { SECTIONS } from "./sections.js";

const sectionsOf = (roles: Role[]) => SECTIONS.filter((section) => roles.includes(section.role));

/** A signed-in person: who they are and the sections their roles open. */
export const StaffHome = ({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) => (
  <div className="staff-home">
    <p className="staff-who">
      <span className="muted">Signed in as</span>
      <strong>{me.username}</strong>
      {me.roles.length === 0 ? <span className="muted">No staff role</span> : null}
    </p>
    <ul className="staff-sections">
      {sectionsOf(me.roles).map((section) => (
        <li key={section.path}>
          <Link href={section.path}>{section.title}</Link>
          <span className="muted">{section.about}</span>
        </li>
      ))}
    </ul>
    <SignOut onSignedOut={onSignedOut} />
  </div>
);
