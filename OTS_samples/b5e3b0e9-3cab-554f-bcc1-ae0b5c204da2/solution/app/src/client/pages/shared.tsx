export function NotFound() {
  return (
    <div class="cell page-cell">
      <h1>Not found.</h1>
      <p>This page does not exist, or you may not open it.</p>
    </div>
  );
}

/** The guides drawing in once: the loading state of a page that is fetching. */
export function Loading() {
  return (
    <div class="loading" role="status" aria-label="Loading">
      <span class="guide guide-a" />
      <span class="guide guide-b" />
      <span class="guide guide-c" />
      <span class="sr-only">Loading</span>
    </div>
  );
}
