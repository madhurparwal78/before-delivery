/**
 * Opens the page's live event stream. Changes must reach an open page within a second, so the stream opens as
 * soon as the page asks for it; callers still reconcile what changed before it connected when it reports
 * `ready`. Returns a cancel function.
 */
export function openWhenQuiet(open: () => void): () => void {
  let cancelled = false;
  queueMicrotask(() => {
    if (!cancelled) open();
  });
  return () => {
    cancelled = true;
  };
}
