// Any unknown object, query, collection or route, inside the frame.
import { COPY } from '../feedback.ts';
import { linkHandler } from '../router.ts';

export function NotFound() {
  return (
    <div className="not-found">
      <h1 tabIndex={-1}>{COPY.notFound}</h1>
      <p className="muted"><a href="/today" onClick={linkHandler('/today', { reveal: true })}>Go to today's note</a></p>
    </div>
  );
}
