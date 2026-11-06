/**
 * The share page: a read-only view of each renter's current compliance
 * documents, opened from a link the operator shares, with no sign-in.
 */

import { api, ApiError } from '../api.js';
import * as copy from '../../shared/copy.js';
import type { ShareResponse } from '../../shared/types.js';
import { el } from '../dom.js';
import type { Cleanup, ScreenContext } from '../router.js';

export function shareScreen(context: ScreenContext): Cleanup {
  const token = context.path.replace(/^\/share\//, '');
  const page = el('div', { class: 'main' }, [el('div', { class: 'share' })]);
  const share = page.firstElementChild as HTMLElement;
  context.root.append(page);

  void (async () => {
    try {
      const answer = await api.get<ShareResponse>(`/api/share/${encodeURIComponent(token)}`);
      share.append(
        el('p', { class: 'wordmark' }, [
          el('span', { text: copy.BRAND_NAME }),
          document.createTextNode(copy.PRODUCT_NAME),
        ]),
        el('h1', { text: 'Current compliance documents' }),
        el('p', { text: answer.kitchen.name }),
        el('p', { text: answer.kitchen.address }),
      );
      if (answer.renters.length === 0) {
        share.append(el('p', { class: 'empty', text: copy.EMPTY_SHARE }));
        return;
      }
      for (const renter of answer.renters) {
        const rows = renter.documents.map((document) =>
          el('div', { class: 'share__doc' }, [
            el('span', { text: document.label }),
            el('span', {
              class: 'mono',
              text: document.expires_on === null ? '' : `Expires ${document.expires_on}`,
            }),
            el('a', {
              text: `Open ${document.label} for ${renter.business_name}`,
              attrs: { href: document.file_url, 'data-external': 'true' },
            }),
          ]),
        );
        share.append(
          el('section', { class: 'panel' }, [
            el('h2', { text: renter.business_name }),
            ...rows,
          ]),
        );
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        share.append(
          el('h1', { text: copy.SHARE_DEAD_HEADING }),
          el('p', { text: copy.SHARE_DEAD_BODY }),
        );
        return;
      }
      share.append(el('p', { class: 'status status--alert', text: copy.GENERIC_ERROR }));
    }
  })();

  return () => undefined;
}
