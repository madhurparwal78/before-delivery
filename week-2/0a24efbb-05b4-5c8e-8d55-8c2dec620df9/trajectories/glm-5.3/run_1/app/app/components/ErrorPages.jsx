import { isRouteErrorResponse } from 'react-router';

export function NotFoundPage({ withChrome }) {
  return (
    <div className={`answer-page${withChrome ? '' : ' bare'}`}>
      <h1>That page does not exist</h1>
      <p>The link may be out of date. Go back to the desk.</p>
      {withChrome && <p><a href="/requests">Go back to the desk</a></p>}
    </div>
  );
}

export function WrongRolePage() {
  return (
    <div className="answer-page">
      <h1>Your role does not have access to this page.</h1>
      <p><a href="/requests">Go back to the desk</a></p>
    </div>
  );
}

export function BadQueryPage() {
  return (
    <div className="answer-page">
      <h1>That filter is not one the queue understands.</h1>
      <p><a href="/requests">Clear filters</a></p>
    </div>
  );
}

export function SharedGonePage() {
  return (
    <div className="answer-page bare">
      <p className="brand-line">Rostara</p>
      <h1>This shared month is no longer available</h1>
      <p>Ask the person who shared it for a new link.</p>
    </div>
  );
}

/** Route error boundary: renders the page answer for the thrown status. */
export function RouteErrorBoundary({ error, signedIn, share }) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  if (share) {
    if (status === 410) return <SharedGonePage />;
    return <NotFoundPage withChrome={false} />;
  }
  if (status === 403) return <WrongRolePage />;
  if (status === 400) return <BadQueryPage />;
  if (status === 404) return <NotFoundPage withChrome />;
  if (status === 401) {
    return (
      <div className="answer-page">
        <h1>Sign in to continue.</h1>
        <p><a href="/login">Sign in</a></p>
      </div>
    );
  }
  return (
    <div className="answer-page">
      <h1>The desk could not complete that. Try again.</h1>
      <p><a href="/requests">Go back to the desk</a></p>
    </div>
  );
}
