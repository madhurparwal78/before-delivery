import { BookOpen, LogIn, LogOut, Upload, Users } from "lucide-react";
import { Mascot } from "../icons";
import { liveChannel } from "../live";
import { Link, navigate } from "../router";
import { session, signOut } from "../session";
import { useStore } from "../store";

const NOTICE = "Recipes bake in your browser: the text you work on stays on this page.";

/** The workspace notice strip across the top of every screen. */
export function InfoStrip() {
  const user = useStore(session, (state) => state.user);
  const paused = useStore(liveChannel, (state) => state.paused);
  const leave = async (): Promise<void> => {
    await signOut();
    navigate("/");
  };
  return (
    <header className="info-strip">
      <Link to="/" className="brand">
        <Mascot size={22} />
        <span>Wringbench</span>
      </Link>
      <div className="notice">
        <span className="notice-line" hidden={paused}>{NOTICE}</span>
        <span role="status" aria-label="Service notice" aria-live="off" className="service-notice">
          {paused ? "Live updates paused. Reconnecting…" : ""}
        </span>
      </div>
      <nav className="strip-links" aria-label="Workspace">
        <Link to="/library">
          <BookOpen size={18} aria-hidden="true" />
          <span>Library</span>
        </Link>
        <Link to="/import">
          <Upload size={18} aria-hidden="true" />
          <span>Import</span>
        </Link>
        <Link to="/team">
          <Users size={18} aria-hidden="true" />
          <span>Team settings</span>
        </Link>
        {user ? (
          <button type="button" className="strip-button" onClick={() => void leave()}>
            <LogOut size={18} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        ) : (
          <Link to="/signin">
            <LogIn size={18} aria-hidden="true" />
            <span>Sign in</span>
          </Link>
        )}
      </nav>
    </header>
  );
}
