import type { ReactNode } from 'react';
import { COPY } from '../../shared/copy';
import { Link } from '../lib/router';

export function NotFound(): ReactNode {
  return (
    <section className="not-found">
      <h1>{COPY.notFoundHeading}</h1>
      <p>
        <Link to="/" className="action-link">
          Back to the programme
        </Link>
      </p>
    </section>
  );
}
