import type { ApiFailure } from "../api.js";

export function NotFoundPage() {
  return (
    <main className="page-state">
      <div className="band band-black band-fill">
        <h1 tabIndex={-1} className="band-heading">
          Not on your register
        </h1>
        <p className="band-sentence">This record isn't on your register.</p>
      </div>
    </main>
  );
}

/** The page for a request that failed: not-found for a record the person may not see, a plain band for a server fault. */
export function FailurePage({ failure }: { failure: ApiFailure }) {
  if (failure.status >= 500) {
    return (
      <main className="page-state">
        <div className="band band-black band-fill" role="alert">
          <p className="band-sentence">Something went wrong on our side. Your register has not changed.</p>
        </div>
      </main>
    );
  }
  return <NotFoundPage />;
}
