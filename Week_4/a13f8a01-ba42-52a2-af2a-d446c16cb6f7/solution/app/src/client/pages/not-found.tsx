import { CourseDrawing } from "../components/icons.js";
import { Shell } from "../components/shell.js";
import { Link } from "../router.js";

export function NotFoundBody(): React.JSX.Element {
  return (
    <section className="not-found">
      <div className="panel">
        <CourseDrawing />
        <h1>Nothing here</h1>
        <p>This pen does not exist, or it is not shared with you.</p>
        <Link to="/explore" className="button primary">
          Go to Explore
        </Link>
      </div>
    </section>
  );
}

export function NotFound(): React.JSX.Element {
  return (
    <Shell>
      <NotFoundBody />
    </Shell>
  );
}
