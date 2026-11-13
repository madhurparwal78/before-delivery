import { Link } from "../app";

export function NotFound() {
  return (
    <section className="notfound">
      <h1>Not on this rack</h1>
      <p>Check the link, or go back to the rack.</p>
      <Link to="/" className="button">Back to the rack</Link>
    </section>
  );
}
