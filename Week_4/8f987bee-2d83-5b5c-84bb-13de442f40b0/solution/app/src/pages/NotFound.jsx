import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section className="container not-found">
      <span className="label eyebrow">404</span>
      <h1 className="display">This page does not exist.</h1>
      <p className="lede">The address may be mistyped, or the page has moved.</p>
      <Link to="/" className="btn btn-primary">Back to home</Link>
    </section>
  );
}
