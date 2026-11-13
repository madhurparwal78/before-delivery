import { Link } from "../router.js";
import { request } from "../api.js";
import { Button } from "../ui.js";
import type { Role } from "../../../shared/domain.js";
import { SECTIONS, STAFF_HOME } from "./sections.js";

export const SignOut = ({ onSignedOut }: { onSignedOut: () => void }) => (
  <Button onClick={() => void request("POST", "/auth/logout").then(onSignedOut, onSignedOut)}>Sign out</Button>
);

/** The secondary row on every staff page: the sections the person's roles allow, then the way out. */
export const StaffNav = ({ roles, path, onSignedOut }: { roles: Role[]; path: string; onSignedOut: () => void }) => (
  <nav className="staff-nav" aria-label="Staff sections">
    <Link href={STAFF_HOME}>Staff</Link>
    {SECTIONS.filter((section) => roles.includes(section.role)).map((section) => (
      <Link key={section.path} href={section.path} aria-current={section.path === path ? "page" : undefined}>{section.title}</Link>
    ))}
    <SignOut onSignedOut={onSignedOut} />
  </nav>
);
