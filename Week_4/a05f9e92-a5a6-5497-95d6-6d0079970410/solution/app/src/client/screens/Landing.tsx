import { PUBLISHED_SERVICES } from "../../shared/services.js";
import { homeScreen } from "../../shared/types.js";
import { Portrait } from "../components/Portrait.js";
import { Link } from "../lib/router.js";
import { useSession } from "../lib/session.js";

export function Landing(): JSX.Element {
  const session = useSession();
  const target = session.user ? homeScreen(session.user.roles) : "/login";
  return (
    <main className="hero">
      <h1 className="hero-name">SWITCHYARD</h1>
      <div className="hero-portraits">
        {PUBLISHED_SERVICES.map((name, index) => (
          <figure key={name} className="hero-portrait">
            <Portrait name={name} palette={index % 5} />
          </figure>
        ))}
      </div>
      <div className="hero-foot">
        <p className="hero-sentence">One person, one organisation, every promise kept on its own clock.</p>
        <Link to={target} className="hero-open">
          Open your desk
        </Link>
      </div>
    </main>
  );
}
