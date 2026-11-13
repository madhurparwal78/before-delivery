import { formatMoney } from '../../shared/money.js';
import { apiGet } from '../api.js';
import { billableDaysLabel, COPY, freeForDatesLabel, hireTotalAnnouncement } from '../copy.js';
import { clear, el, svgIcon } from '../dom.js';
import { mountServiceNotice } from '../notice.js';
import { rollTotal } from '../strip.js';
import {
  createDateControls,
  createHireTotalStatus,
  createPriceFetcher,
  dateQuery,
  pageDateQuery,
  readDateSelection,
  returnDateOf,
  writeDateSelection,
} from '../renter.js';
import type { KitView, PriceQuote } from '../../shared/types.js';

interface SheetParts {
  numerals: HTMLElement;
  count: HTMLElement;
  free: HTMLElement;
  open: HTMLAnchorElement;
  shownCents: number;
}

/** Lucide marks for the seeded categories, drawn as procedural SVG. */
function categoryIcon(category: string): SVGElement {
  return svgIcon(category === 'Lighting' ? 'sun' : 'camera', 22);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function categoryNav(categories: string[], hrefPrefix: string): HTMLElement {
  return el(
    'nav',
    { 'aria-label': 'Kit categories', class: 'category-rail' },
    categories.map((category) =>
      el('a', { class: 'category-link', href: `${hrefPrefix}#category-${slug(category)}` }, [
        categoryIcon(category),
        el('span', {}, [category]),
      ]),
    ),
  );
}

function buildSheet(kit: KitView): { element: HTMLElement; parts: SheetParts } {
  const numerals = el('p', { class: 'numerals' }, [formatMoney(kit.dayRateCents)]);
  const count = el('p', { class: 'billable-count' });
  const free = el('p', { class: 'free-count' });
  const open = el('a', { class: 'sheet-open', href: `/kits/${kit.id}` }, [`Open ${kit.name}`]);

  const element = el('article', { 'aria-label': kit.name, class: 'sheet' }, [
    el('div', { class: 'sheet-band' }, [
      el('h2', { class: 'kit-name' }, [kit.name]),
      el('div', { class: 'sheet-figures' }, [numerals, count]),
      free,
    ]),
    el('div', { class: 'sheet-body' }, [
      el('h3', { class: 'component-title' }, ['Components']),
      el(
        'ul',
        { class: 'component-list' },
        kit.components.map((component) =>
          el('li', {}, [
            el('span', { class: 'component-name' }, [component.name]),
            el('span', { class: 'component-value' }, [
              `${formatMoney(component.replacementValueCents)} replacement`,
            ]),
          ]),
        ),
      ),
      open,
    ]),
  ]);
  return { element, parts: { numerals, count, free, open, shownCents: kit.dayRateCents } };
}

export async function renderCatalogue(root: HTMLElement): Promise<void> {
  clear(root);
  let selection = readDateSelection();
  let announced = '';

  const page = el('div', { class: 'page page-catalogue' });
  root.append(page);
  mountServiceNotice(page);

  const kits = (await apiGet<{ kits: KitView[] }>('/api/kits')).kits;
  const categories = [...new Set(kits.map((kit) => kit.category))];
  const headline = kits[0];
  if (headline === undefined) throw new Error('The catalogue has no kits');

  const status = createHireTotalStatus();
  status.hidden = selection.pickupDate === null;
  const prompt = el('div', { class: 'prompt' });
  const sheetsHost = el('div', { class: 'sheets' });
  const parts = new Map<string, SheetParts>();

  for (const category of categories) {
    const section = el('section', { class: 'category', id: `category-${slug(category)}` }, [
      el('h2', { class: 'category-heading' }, [categoryIcon(category), el('span', {}, [category])]),
    ]);
    for (const kit of kits.filter((candidate) => candidate.category === category)) {
      const sheet = buildSheet(kit);
      parts.set(kit.id, sheet.parts);
      section.append(sheet.element);
    }
    sheetsHost.append(section);
  }

  const showPrompt = (kind: 'none' | 'no-dates' | 'nothing-free'): void => {
    clear(prompt);
    sheetsHost.hidden = kind === 'nothing-free';
    if (kind === 'none') return;
    const heading = kind === 'no-dates' ? COPY.noDatesHeading : COPY.nothingFreeHeading;
    const body = kind === 'no-dates' ? COPY.noDatesText : COPY.nothingFreeText;
    prompt.append(el('h2', { class: 'prompt-heading' }, [svgIcon('calendar', 24), el('span', {}, [heading])]));
    prompt.append(el('p', { class: 'prompt-text' }, [body]));
  };

  const updateSheets = async (quote: PriceQuote | null): Promise<void> => {
    const rangeQuery = dateQuery(selection);
    const latest = (await apiGet<{ kits: KitView[] }>(`/api/kits${rangeQuery}`)).kits;
    if (rangeQuery !== dateQuery(selection)) return;
    const datesSet = selection.pickupDate !== null && returnDateOf(selection) !== null;
    if (datesSet && latest.every((kit) => (kit.freeForDates ?? 0) === 0)) {
      showPrompt('nothing-free');
    } else {
      showPrompt(datesSet ? 'none' : 'no-dates');
    }

    for (const kit of latest) {
      const part = parts.get(kit.id);
      if (part === undefined) continue;
      part.open.href = `/kits/${kit.id}${pageDateQuery(selection)}`;
      part.free.textContent = kit.freeForDates === null ? '' : freeForDatesLabel(kit.freeForDates);
      const price = kit.price;
      if (price === null) {
        rollTotal(part.numerals, kit.dayRateCents, kit.dayRateCents, formatMoney, () => { part.count.textContent = ''; });
        part.count.textContent = '';
        part.shownCents = kit.dayRateCents;
        continue;
      }
      const from = part.shownCents;
      part.shownCents = price.hirePriceCents;
      const isHeadline = kit.id === headline.id;
      rollTotal(part.numerals, from, price.hirePriceCents, formatMoney, () => {
        part.count.textContent = billableDaysLabel(price.billableDays);
        if (!isHeadline) return;
        const announcement = hireTotalAnnouncement(price.hirePriceCents, price.billableDays);
        if (announcement === announced) return;
        announced = announcement;
        status.textContent = announcement;
      });
    }
    if (quote !== null) controls.strip.setDays(quote.days);
  };

  const fetcher = createPriceFetcher(
    headline.id,
    (quote) => { controls.error.textContent = ''; void updateSheets(quote); },
    () => {
      controls.error.textContent = '';
      status.textContent = '';
      controls.strip.setDays([]);
      void updateSheets(null);
    },
    (message) => { controls.error.textContent = message; status.textContent = message; announced = ''; },
  );

  const controls = createDateControls({
    initial: selection,
    onChange: (next) => {
      selection = next;
      status.hidden = selection.pickupDate === null;
      writeDateSelection(selection);
      fetcher.request(selection);
    },
  });

  page.append(
    categoryNav(categories, ''),
    el('div', { class: 'catalogue-main' }, [controls.element, status, prompt, sheetsHost]),
  );

  showPrompt(selection.pickupDate === null ? 'no-dates' : 'none');
  fetcher.request(selection);
}
