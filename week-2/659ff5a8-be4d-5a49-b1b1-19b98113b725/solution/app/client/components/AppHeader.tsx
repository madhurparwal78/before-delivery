import { Link, useNavigation } from "../router.js";
import { useSession } from "../session.js";
import { ConeMark } from "./ui.js";

export function AppHeader() {
  const { user, signOut } = useSession();
  const { navigate, route } = useNavigation();
  if (!user) return null;
  const member = user.club !== null;
  const current = (name: string): "page" | undefined => (route.name === name ? "page" : undefined);
  return (
    <header className="app-header">
      <Link href={member ? "/events" : "/operator"} className="brand">
        <ConeMark />
        <span>Conecount Paddock</span>
      </Link>
      {member ? (
        <nav aria-label="Club sections" className="club-nav">
          <Link href="/events" aria-current={current("events") ?? (route.name === "event" ? "page" : undefined)}>
            Events
          </Link>
          <Link href="/index-tables" aria-current={current("index-tables")}>
            Index tables
          </Link>
          <Link href="/season" aria-current={current("season")}>
            Season
          </Link>
        </nav>
      ) : null}
      <div className="who">
        <span className="who-name">{user.club ? `${user.name}, ${user.club.name}` : user.name}</span>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            void signOut().then(() => navigate("/signin"));
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
