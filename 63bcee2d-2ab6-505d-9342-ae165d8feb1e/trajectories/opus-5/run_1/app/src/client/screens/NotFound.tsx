import { refusal } from '../lib/copy.js';
import { Link, setPageTitle } from '../lib/router.jsx';

export function NotFound(): JSX.Element {
  setPageTitle('Page not found · Marrow Hall Interiors');
  return (
    <section className="panel form-card">
      <h1>Page not found</h1>
      <p>{refusal.notFound}</p>
      <p>
        <Link to="/">Marrow Hall Interiors home</Link>
      </p>
    </section>
  );
}
