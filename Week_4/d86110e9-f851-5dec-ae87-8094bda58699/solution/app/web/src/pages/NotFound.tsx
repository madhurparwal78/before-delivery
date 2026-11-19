import { Link, useTitle } from '../router';
import '../build/styles/site.css';

export function NotFound() {
  useTitle('Not found');
  return (
    <section className="panel-dark on-dark not-found">
      <h1>We couldn't find that page</h1>
      <p>It may have moved, or you may not have access to it.</p>
      <Link to="/" className="link-on-dark">
        Back to start
      </Link>
    </section>
  );
}
