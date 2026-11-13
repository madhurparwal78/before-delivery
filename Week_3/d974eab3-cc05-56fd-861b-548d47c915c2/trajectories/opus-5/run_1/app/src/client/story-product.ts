import { escapeHtml } from '../shared/escape';
import {
  editionLine,
  formatLine,
  ingredientAmount,
  notMedicineNotice,
  packLine,
  productLine,
  servingLine,
  storageLine,
} from '../shared/format';
import {
  SHEET_PENDING_ANNOUNCEMENT,
  SHEET_READY_ANNOUNCEMENT,
  SHEET_UNAVAILABLE_MESSAGE,
  packViewAnnouncement,
} from '../shared/messages';
import type { ContentResponse, Product } from '../shared/types';
import { fetchProductSheet } from './api';
import { PACK_VIEWS, packFaces, type PackView } from './art';
import {
  all,
  announce,
  clearAlert,
  fillWith,
  find,
  need,
  showAlert,
} from './dom';
import { TabList } from './tablist';

const REVOKE_DELAY_MS = 10_000;

function detailsPanel(product: Product): string {
  return `<p>${escapeHtml(formatLine(product))}</p>
<p>${escapeHtml(servingLine(product))}</p>
${product.packs.map((pack) => `<p>${escapeHtml(packLine(pack))}</p>`).join('')}`;
}

function ingredientsPanel(product: Product): string {
  const rows = product.ingredients
    .map(
      (ingredient) =>
        `<tr${/beet/i.test(ingredient.name) ? ' class="is-beet"' : ''}>` +
        `<th scope="row">${escapeHtml(ingredient.name)}</th>` +
        `<td class="amount">${escapeHtml(ingredientAmount(ingredient))}</td></tr>`,
    )
    .join('');
  return `<table class="ingredients" aria-label="Ingredients per stick">
<thead><tr><th scope="col">Ingredient</th><th scope="col">Amount</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p class="notice">${escapeHtml(notMedicineNotice(product.name))}</p>`;
}

function howToUsePanel(product: Product): string {
  return `<ol class="steps">${product.how_to_use
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join('')}</ol>
<p>${escapeHtml(storageLine(product))}</p>
<h3>Cautions</h3>
<ul class="cautions">${product.cautions
    .map((caution) => `<li>${escapeHtml(caution)}</li>`)
    .join('')}</ul>`;
}

function setupPackViews(pack: HTMLElement, productName: string): void {
  const apply = (view: PackView, shouldAnnounce: boolean): void => {
    pack.dataset['view'] = view;
    pack.setAttribute('aria-label', `${productName} pack, ${view} view`);
    if (shouldAnnounce) {
      announce(packViewAnnouncement(view));
    }
  };
  for (const radio of all<HTMLInputElement>('[data-pack-view]')) {
    radio.addEventListener('change', () => {
      const view = PACK_VIEWS.find((name) => name === radio.value);
      if (view !== undefined && radio.checked) {
        apply(view, true);
      }
    });
  }
  const checked = find<HTMLInputElement>('[data-pack-view]:checked');
  apply(
    PACK_VIEWS.find((name) => name === checked?.value) ?? 'front',
    false,
  );
}

function setupSheetDownload(): void {
  const button = need<HTMLButtonElement>('[data-sheet-download]');
  const host = need<HTMLElement>('[data-sheet-host]');
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'true') {
      return;
    }
    clearAlert(host);
    button.setAttribute('aria-disabled', 'true');
    announce(SHEET_PENDING_ANNOUNCEMENT);
    void fetchProductSheet().then((file) => {
      button.removeAttribute('aria-disabled');
      button.focus();
      if (file === null) {
        showAlert(host, SHEET_UNAVAILABLE_MESSAGE);
        return;
      }
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, REVOKE_DELAY_MS);
      announce(SHEET_READY_ANNOUNCEMENT);
    });
  });
}

/** The Product chapter, built from the stored product record. */
export function renderProduct(content: ContentResponse): void {
  const { product, edition } = content;
  need<HTMLElement>('[data-product-name]').textContent = product.name;
  need<HTMLElement>('[data-product-line]').textContent = productLine(product);
  need<HTMLElement>('[data-notice]').textContent = notMedicineNotice(
    product.name,
  );
  need<HTMLElement>('[data-edition-line]').textContent = editionLine(edition);

  const pack = need<HTMLElement>('[data-pack]');
  fillWith(pack, packFaces(product.name));
  setupPackViews(pack, product.name);

  const panels = [
    detailsPanel(product),
    ingredientsPanel(product),
    howToUsePanel(product),
  ];
  all<HTMLElement>('[data-product-panel]').forEach((panel, index) => {
    fillWith(panel, panels[index] ?? '');
  });
  new TabList(need<HTMLElement>('[aria-label="Product information"]'));
  setupSheetDownload();
}
