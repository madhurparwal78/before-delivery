/**
 * The share page refreshes in place every 30 seconds, so the operator's newest changes show
 * without a page load and with the scroll position kept.
 *
 * The page never works out state, ruling, cover, link lifetime or promise for itself: it
 * asks the server for the claim and, when something has moved, re-reads the server's own
 * rendering of the page.
 */

import { ApiRefusal, callApi, clearAlert, find, refusalText, showAlert } from './dom';

const REFRESH_MS = 30_000;

interface ShareView {
  state: string;
  ruling: unknown;
  quote: unknown;
  paid_minor: number | null;
  decline: unknown;
  dispatched_at: string | null;
  history: { state: string; at: string }[];
}

function fingerprint(view: ShareView): string {
  return JSON.stringify([view.state, view.ruling, view.quote, view.paid_minor, view.decline, view.dispatched_at, view.history.length]);
}

/** Swaps the fan and slip for the server's freshly rendered ones, keeping scroll and focus. */
async function reRender(token: string): Promise<void> {
  const response = await fetch(`/s/${encodeURIComponent(token)}`, { headers: { accept: 'text/html' } });
  if (!response.ok) return;
  const markup = await response.text();
  const fresh = new DOMParser().parseFromString(markup, 'text/html');

  const layout = find<HTMLElement>('.share-layout');
  const freshLayout = fresh.querySelector<HTMLElement>('.share-layout');
  if (layout === null || freshLayout === null) return;

  const scroll = window.scrollY;
  const focused = document.activeElement as HTMLElement | null;
  const focusedId = focused?.id ?? '';

  layout.innerHTML = freshLayout.innerHTML;
  window.scrollTo({ top: scroll });
  if (focusedId !== '') document.getElementById(focusedId)?.focus();

  // The new markup brings its own fan and disclosure, which need wiring again.
  window.dispatchEvent(new CustomEvent('desk:remount'));
}

export function wireSharePage(token: string): void {
  let seen = '';

  void callApi<ShareView>(`/api/share/${encodeURIComponent(token)}`)
    .then((view) => {
      seen = fingerprint(view);
    })
    .catch(() => undefined);

  const tick = (): void => {
    void callApi<ShareView>(`/api/share/${encodeURIComponent(token)}`)
      .then(async (view) => {
        // A successful refresh empties a stale alert.
        clearAlert();
        const next = fingerprint(view);
        if (next !== seen) {
          seen = next;
          await reRender(token);
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiRefusal)) return;
        const { status, code } = error.failure;
        if (status === 503) {
          // The last loaded content stays through a records outage.
          showAlert(refusalText('database_unavailable'));
          return;
        }
        if (status === 410 || status === 404) {
          const layout = find<HTMLElement>('.share-layout');
          if (layout !== null) layout.remove();
          showAlert(refusalText(code));
        }
      })
      .finally(() => {
        window.setTimeout(tick, REFRESH_MS);
      });
  };

  window.setTimeout(tick, REFRESH_MS);
}
