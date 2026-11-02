import type { ReactElement } from 'react';
import { NOT_FOUND_HEADING } from '../../../shared/copy.js';
import { Link } from '../router.js';

export function NotFound(): ReactElement {
  return (
    <div className="page paper narrow">
      <h1>{NOT_FOUND_HEADING}</h1>
      <p>The address may have changed, or the crate it belonged to has moved on.</p>
      <Link to="/" className="button button--primary">
        Back to the shop
      </Link>
    </div>
  );
}
