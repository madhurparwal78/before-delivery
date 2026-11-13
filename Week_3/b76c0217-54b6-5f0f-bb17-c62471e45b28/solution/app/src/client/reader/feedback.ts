import { copy } from '../../shared/copy';
import type { PageJson, ReaderBoot } from '../../shared/types';
import { announce, tell } from '../shared/dom';
import { follow } from '../shared/stream';
import { enhanceContent } from './components';

function initRatings(boot: ReaderBoot): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-vote]')];
  for (const button of buttons) {
    button.addEventListener('click', async () => {
      const vote = button.getAttribute('aria-pressed') === 'true' ? null : button.dataset.vote;
      const response = await fetch(`/docs/${boot.siteSlug}/ratings/${boot.pageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote }),
      });
      if (response.ok) {
        for (const other of buttons) {
          other.setAttribute('aria-pressed', String(other.dataset.vote === vote));
        }
        tell(vote === null ? copy.feedbackRemoved : copy.thanks);
      }
    });
  }
}

/** A published page the reader has open changed: tell them, and change nothing until they choose Reload. */
function watchPublishes(boot: ReaderBoot): void {
  const banner = document.getElementById('update-banner');
  document.getElementById('update-reload')?.addEventListener('click', () => location.reload());
  follow(`/docs/${boot.siteSlug}/events`, (event, data) => {
    const { changedPageIds } = data as { changedPageIds: string[] };
    if (event === 'published' && banner !== null && boot.pageId !== null && changedPageIds.includes(boot.pageId)) {
      banner.hidden = false;
      announce(copy.updateBanner);
    }
  });
}

/** The signed-in preview shows each autosave of its page within a second, without a reload. */
function watchDraft(boot: ReaderBoot): void {
  let refreshing = false;
  follow(`/api/events?pageId=${boot.pageId}`, async (event, data) => {
    const page = data as PageJson;
    if (event !== 'page' || page.id !== boot.pageId || refreshing) {
      return;
    }
    refreshing = true;
    try {
      const html = await (await fetch(location.href, { headers: { Accept: 'text/html' } })).text();
      const next = new DOMParser().parseFromString(html, 'text/html');
      for (const selector of ['main', '.toc-wrap', '#site-nav nav[aria-label="Docs"]']) {
        const fresh = next.querySelector(selector);
        const stale = document.querySelector(selector);
        if (fresh !== null && stale !== null) {
          stale.replaceWith(document.importNode(fresh, true));
        }
      }
      document.title = next.title;
      enhanceContent(document, boot);
    } finally {
      refreshing = false;
    }
  });
}

export function initFeedback(boot: ReaderBoot): void {
  if (boot.mode === 'public' && boot.pageId !== null) {
    initRatings(boot);
    watchPublishes(boot);
  }
  if (boot.mode === 'draft' && boot.pageId !== null) {
    watchDraft(boot);
  }
}
