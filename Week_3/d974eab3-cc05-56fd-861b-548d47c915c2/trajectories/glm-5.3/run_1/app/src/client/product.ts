import {
  announceStatus,
  editionLine,
  escapeHtml,
  ingredientAmount,
  notAMedicine,
  packLine,
  productLine,
  type Content,
  type InterviewDetail,
} from './core.js';
import { packPicture, portrait } from './art.js';

export function renderInterviewList(content: Content, filter: 'all' | 'expert' | 'everyday', announce = true): void {
  const list = document.querySelector<HTMLElement>('[data-interview-list]');
  if (!list) return;
  const shown = content.interviews.filter(
    (interview) => filter === 'all' || interview.category === filter,
  );
  list.innerHTML = shown
    .map(
      (interview) => `<li role="listitem">
  <article class="interview-card">
    <div class="portrait" aria-hidden="true">${portrait(interview.hue)}</div>
    <h3>${escapeHtml(interview.name)}</h3>
    <p class="interview-role">${escapeHtml(interview.role)}</p>
    <p class="interview-label">${interview.category === 'expert' ? 'Expert' : 'Everyday'}</p>
    <p class="interview-lede">${escapeHtml(interview.lede)}</p>
    <p><a class="action-link" href="/interviews/${interview.slug}">Read the interview with ${escapeHtml(interview.name)}</a></p>
  </article>
</li>`,
    )
    .join('');
  if (announce) {
    const count = shown.length;
    announceStatus(count === 1 ? 'Showing 1 interview.' : `Showing ${count} interviews.`);
  }
}

export function initInterviewFilter(content: Content): void {
  const radios = Array.from(document.querySelectorAll<HTMLInputElement>('[data-interview-filter]'));
  if (radios.length === 0) return;
  const apply = (announce = true) => {
    const checked = radios.find((radio) => radio.checked);
    renderInterviewList(content, (checked?.value as 'all' | 'expert' | 'everyday') ?? 'all', announce);
  };
  radios.forEach((radio) => {
    radio.addEventListener('change', () => apply());
  });
  const fieldset = radios[0]?.closest('fieldset');
  fieldset?.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const values = radios.map((radio) => radio.value);
    const checked = radios.findIndex((radio) => radio.checked);
    const nextIndex = (checked + (event.key === 'ArrowRight' ? 1 : values.length - 1)) % values.length;
    const next = radios[nextIndex];
    if (!next) return;
    next.checked = true;
    next.focus();
    apply();
  });
  renderInterviewList(content, 'all', false);
}

export function renderInterviewDetail(interview: InterviewDetail): void {
  const name = document.querySelector<HTMLElement>('[data-interview-name]');
  const role = document.querySelector<HTMLElement>('[data-interview-role]');
  const lede = document.querySelector<HTMLElement>('[data-interview-lede]');
  const portraitBox = document.querySelector<HTMLElement>('[data-interview-portrait]');
  const answers = document.querySelector<HTMLElement>('[data-interview-answers]');
  const nav = document.querySelector<HTMLElement>('[data-interview-nav]');
  if (!name || !role || !lede || !portraitBox || !answers || !nav) return;

  document.title = `${interview.name} | Vireo Pace interviews`;
  name.textContent = interview.name;
  role.textContent = interview.role;
  lede.textContent = interview.lede;
  portraitBox.innerHTML = portrait(interview.hue);
  answers.innerHTML = interview.answers
    .map(
      (answer) => `<section class="interview-answer">
  <h2>${escapeHtml(answer.question)}</h2>
  <p>${escapeHtml(answer.answer)}</p>
</section>`,
    )
    .join('');
  const previous = interview.previous
    ? `<a class="action-link" href="/interviews/${interview.previous.slug}">Previous interview: ${escapeHtml(interview.previous.name)}</a>`
    : '';
  const next = interview.next
    ? `<a class="action-link" href="/interviews/${interview.next.slug}">Next interview: ${escapeHtml(interview.next.name)}</a>`
    : '';
  nav.innerHTML = `${previous}${next}`;

  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' && interview.next) {
      window.location.assign(`/interviews/${interview.next.slug}`);
    } else if (event.key === 'ArrowLeft' && interview.previous) {
      window.location.assign(`/interviews/${interview.previous.slug}`);
    }
  });

  window.setTimeout(() => name.focus({ preventScroll: true }), 0);
}

export function renderProduct(content: Content): void {
  const product = content.product;
  const name = document.querySelector<HTMLElement>('[data-product-name]');
  const line = document.querySelector<HTMLElement>('[data-product-line]');
  const picture = document.querySelector<HTMLElement>('[data-pack-picture]');
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('[data-product-tab]'));
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-product-panel]'));
  const edition = document.querySelector<HTMLElement>('[data-edition-line]');
  if (!name || !line || !picture || tabs.length !== 3 || panels.length !== 3) return;

  name.textContent = product.name;
  line.textContent = productLine(product);
  const setView = (view: 'front' | 'side' | 'back') => {
    picture.setAttribute('data-view', view);
    picture.setAttribute('role', 'img');
    picture.setAttribute('aria-label', `${product.name} pack, ${view} view`);
    picture.innerHTML = packPicture(product, view);
  };
  setView('front');

  const details = [
    `Format: ${product.format}`,
    `Serving: ${product.serving}`,
    ...product.packs.map((pack) => packLine(pack)),
  ].map((entry) => `<p>${escapeHtml(entry)}</p>`).join('');
  const ingredients = `<table class="ingredients-table"><caption class="visually-hidden">Ingredients per stick</caption><thead><tr><th scope="col">Ingredient</th><th scope="col">Amount</th></tr></thead><tbody>${product.ingredients
    .map(
      (ingredient) =>
        `<tr class="beet-row"><td>${escapeHtml(ingredient.name)}</td><td class="amount">${escapeHtml(ingredientAmount(ingredient.mg))}</td></tr>`,
    )
    .join('')}</tbody></table><p class="notice">${escapeHtml(notAMedicine(product))}</p>`;
  const howTo = `<ol class="how-to-use">${product.how_to_use
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join('')}</ol><p>Storage: ${escapeHtml(product.storage)}</p><h3>Cautions</h3><ul>${product.cautions
    .map((caution) => `<li>${escapeHtml(caution)}</li>`)
    .join('')}</ul>`;

  panels[0]!.innerHTML = details;
  panels[1]!.innerHTML = ingredients;
  panels[2]!.innerHTML = howTo;

  if (edition) edition.textContent = editionLine(content.edition);

  const tablist = document.querySelector<HTMLElement>('[data-product-tablist]');
  const selected = () => tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  const focusIndex = () => {
    const index = tabs.findIndex((tab) => tab === document.activeElement);
    return index === -1 ? selected() : index;
  };
  const select = (index: number) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    panels.forEach((panel, i) => {
      panel.hidden = i !== index;
    });
  };
  tablist?.addEventListener('keydown', (event) => {
    const keys: Record<string, number | null> = {
      ArrowRight: (focusIndex() + 1) % 3,
      ArrowLeft: (focusIndex() + 2) % 3,
      Home: 0,
      End: 2,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    if (target === null) return;
    select(target);
    tabs[target]?.focus();
  });
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      select(Number(tab.getAttribute('data-product-tab')) - 1);
    });
  });

  const viewRadios = Array.from(document.querySelectorAll<HTMLInputElement>('[data-view-radio]'));
  viewRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      setView(radio.value as 'front' | 'side' | 'back');
      announceStatus(`Showing the ${radio.value} of the pack.`);
    });
  });

  const sheetButton = document.querySelector<HTMLButtonElement>('[data-sheet-button]');
  const sheetAlert = document.querySelector<HTMLElement>('[data-sheet-alert]');
  sheetButton?.addEventListener('click', () => {
    if (sheetButton.getAttribute('aria-disabled') === 'true') return;
    if (sheetAlert) sheetAlert.textContent = '';
    sheetButton.setAttribute('aria-disabled', 'true');
    announceStatus('Preparing the product sheet.');
    fetch('/api/product/sheet')
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json()) as { message: string };
          throw new Error(body.message);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'vireo-pace-product-sheet.pdf';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        sheetButton.removeAttribute('aria-disabled');
        announceStatus('Product sheet ready.');
      })
      .catch((error: Error) => {
        sheetButton.removeAttribute('aria-disabled');
        if (sheetAlert) {
          sheetAlert.setAttribute('role', 'alert');
          sheetAlert.textContent = error.message;
        }
      });
  });
}

export function renderStore(content: Content): void {
  const packs = document.querySelector<HTMLElement>('[data-store-packs]');
  const stores = document.querySelector<HTMLElement>('[data-store-list]');
  const edition = document.querySelector<HTMLElement>('[data-edition-line]');
  if (!packs || !stores) return;
  packs.innerHTML = content.product.packs
    .map(
      (pack) =>
        `<p>${escapeHtml(content.product.name)}, ${pack.sticks} sticks</p><p>¥${pack.price_yen.toLocaleString('en-US')} (tax included)</p>`,
    )
    .join('');
  stores.innerHTML = content.product.stores
    .map(
      (store) =>
        `<li><a class="action-link" href="${store.url}" target="_blank" rel="noopener noreferrer">Buy at ${escapeHtml(store.name)} (opens in a new tab)</a></li>`,
    )
    .join('');
  if (edition) edition.textContent = editionLine(content.edition);
}
