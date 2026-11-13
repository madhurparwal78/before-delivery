import { Link } from "../lib/router";

export function NotFound() {
  return (
    <div className="stack">
      <h1>Page not found.</h1>
      <Link to="/explore" className="btn btn-primary">Go to Explore</Link>
    </div>
  );
}
