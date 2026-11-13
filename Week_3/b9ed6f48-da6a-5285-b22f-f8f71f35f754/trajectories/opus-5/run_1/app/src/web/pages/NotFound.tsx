import { Link } from '../lib/router.js';
import { copy } from '../../shared/copy.js';

export function NotFound(): JSX.Element {
  return (
    <>
      <h1>{copy.notFoundHeading}</h1>
      <p>
        <Link to="/">Back to the chapter index</Link>
      </p>
    </>
  );
}
