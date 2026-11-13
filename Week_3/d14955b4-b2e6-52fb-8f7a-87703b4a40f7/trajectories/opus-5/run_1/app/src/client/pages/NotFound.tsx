import { COPY } from '../../shared/copy';
import { linkHandler } from '../lib/router';

export function NotFoundPage(): React.ReactElement {
  return (
    <div className="column form-page">
      <h1>{COPY.notFoundHeading}</h1>
      <p>
        <a className="accent-button" href="/inbox" onClick={linkHandler('/inbox')}>
          {COPY.notFoundLink}
        </a>
      </p>
    </div>
  );
}
