import type { ReactNode } from 'react';
import { Link } from '../router.js';

export function NotFound(): ReactNode {
  return (
    <section className="page narrow-page">
      <h1>We couldn&apos;t find that page.</h1>
      <p>Check the address, or start again from the story or the configurator.</p>
      <p><Link to="/configure" className="btn primary">Open the configurator</Link></p>
    </section>
  );
}
