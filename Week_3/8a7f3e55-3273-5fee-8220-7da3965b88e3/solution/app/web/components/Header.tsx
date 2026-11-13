import type { Agency, Role, SessionUser } from "../../shared/api";
import { useAction } from "../lib/actions";
import { ApiFailure, apiDelete } from "../lib/api";
import { ROLE_LABELS } from "../lib/copy";

const HOME_LINK: Record<Role, string> = {
  coordinator: "Coverage board",
  interpreter: "My work",
  requester: "Bookings",
  billing_manager: "Billing",
};

/** A session that already ended elsewhere is signed out all the same. */
function endedAlready(failure: unknown): boolean {
  if (failure instanceof ApiFailure && failure.status === 401) return true;
  throw failure;
}

interface HeaderProps {
  user: SessionUser;
  agency: Agency;
  onNavigate: (to: string) => void;
  onSignedOut: () => void;
}

/** The header strip: product name, who is signed in, the agency time zone and Sign out. */
export function Header({ user, agency, onNavigate, onSignedOut }: HeaderProps) {
  const action = useAction();
  const signOut = async () => {
    const done = await action.run({ kind: "sign_out", pending: null, work: () => apiDelete("/api/session").then(() => true, endedAlready), success: () => "" });
    if (done) onSignedOut();
  };
  const home = user.role === "billing_manager" ? "/billing" : "/";
  return (
    <header className="strip">
      <p className="strip-brand">Relayline</p>
      <nav aria-label="Main" className="strip-nav">
        <a
          href={home}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(home);
          }}
        >
          {HOME_LINK[user.role]}
        </a>
      </nav>
      <div className="strip-id">
        <p className="strip-who">
          Signed in as {user.name} · {ROLE_LABELS[user.role]}
        </p>
        <p className="strip-zone mono">Times in {agency.time_zone}</p>
      </div>
      <button type="button" className="btn" disabled={action.pending} onClick={() => void signOut()}>
        Sign out
      </button>
    </header>
  );
}
