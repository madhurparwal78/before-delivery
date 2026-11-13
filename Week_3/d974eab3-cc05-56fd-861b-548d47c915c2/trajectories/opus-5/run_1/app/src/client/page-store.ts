import { escapeHtml } from '../shared/escape';
import { editionLine, storePackLine, storePriceLine } from '../shared/format';
import type { ContentResponse } from '../shared/types';
import { fillWith, need } from './dom';

/** The online store page, built from the stored product record. */
export function renderStorePage(content: ContentResponse): void {
  const { product, edition } = content;
  fillWith(
    need<HTMLElement>('[data-store-packs]'),
    product.packs
      .map(
        (pack) =>
          `<p class="store__pack">${escapeHtml(storePackLine(product, pack))}</p>
<p class="store__price">${escapeHtml(storePriceLine(pack))}</p>`,
      )
      .join(''),
  );
  fillWith(
    need<HTMLElement>('[data-store-links]'),
    product.stores
      .map(
        (store) =>
          `<li><a href="${escapeHtml(store.url)}" target="_blank" rel="noopener noreferrer">Buy at ${escapeHtml(store.name)} (opens in a new tab)</a></li>`,
      )
      .join(''),
  );
  need<HTMLElement>('[data-edition-line]').textContent = editionLine(edition);
}
