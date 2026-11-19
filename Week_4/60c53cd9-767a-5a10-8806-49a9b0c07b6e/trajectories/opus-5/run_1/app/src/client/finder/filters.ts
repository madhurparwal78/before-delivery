/** The filter controls: chips, search text, price bounds and Clear filters. */

import { el, icon } from '../dom';
import { FIELD_MESSAGES } from '../../shared/errors';
import {
  FACET_VALUES,
  FACET_VALUE_LIMIT,
  SEARCH_TEXT_LIMIT,
  type SearchFilters,
} from '../../shared/searchInput';
import { AVAILABILITY_LABELS, BAND_LABELS, BEDROOM_LABELS, VIEW_LABELS } from '../../shared/labels';
import type { FacetName } from '../../shared/types';
import type { BandId, ViewTag } from '../../shared/units';

const SETTLE_MS = 250;

interface Group {
  name: FacetName;
  title: string;
  label: (value: string) => string;
}

const GROUPS: Group[] = [
  { name: 'bedrooms', title: 'Bedrooms', label: (value) => BEDROOM_LABELS[value] },
  { name: 'band', title: 'Floors', label: (value) => BAND_LABELS[value as BandId] },
  { name: 'facing', title: 'Facing', label: (value) => value },
  { name: 'view', title: 'View', label: (value) => VIEW_LABELS[value as ViewTag] },
  { name: 'status', title: 'Availability', label: (value) => AVAILABILITY_LABELS[value] },
];

export interface FilterPanelOptions {
  onSettled: (filters: SearchFilters) => void;
}

export class FilterPanel {
  readonly node: HTMLElement;
  private filters: SearchFilters;
  private readonly chips = new Map<string, HTMLInputElement>();
  private readonly chipLabels = new Map<string, HTMLElement>();
  private readonly groupErrors = new Map<FacetName, HTMLElement>();
  private readonly searchBox: HTMLInputElement;
  private readonly searchError: HTMLElement;
  private readonly lowest: HTMLInputElement;
  private readonly highest: HTMLInputElement;
  private readonly priceErrors = new Map<'priceMin' | 'priceMax', HTMLElement>();
  private settleTimer = 0;
  private unavailable = false;

  constructor(initial: SearchFilters, private readonly options: FilterPanelOptions) {
    this.filters = { ...initial };
    this.searchBox = el('input', {
      type: 'search',
      class: 'input',
      id: 'filter-search',
      'aria-label': 'Search homes',
      value: initial.q,
      autocomplete: 'off',
    }) as HTMLInputElement;
    this.searchError = el('p', { class: 'field-error', id: 'filter-search-error' });
    this.searchBox.addEventListener('input', () => this.onTextInput());

    this.lowest = this.priceInput('Lowest price', 'priceMin', initial.priceMin);
    this.highest = this.priceInput('Highest price', 'priceMax', initial.priceMax);

    const clear = el('button', {
      type: 'button',
      class: 'action action-quiet',
      text: 'Clear filters',
      onclick: () => this.clear(),
    });

    this.node = el('div', { class: 'filters-body' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'filter-search', text: 'Search homes' }),
        this.searchBox,
        this.searchError,
      ]),
      ...GROUPS.map((group) => this.buildGroup(group)),
      el('div', { class: 'price-fields' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'filter-priceMin', text: 'Lowest price' }),
          this.lowest,
          this.priceErrors.get('priceMin') as HTMLElement,
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'filter-priceMax', text: 'Highest price' }),
          this.highest,
          this.priceErrors.get('priceMax') as HTMLElement,
        ]),
      ]),
      clear,
    ]);
  }

  private priceInput(label: string, field: 'priceMin' | 'priceMax', value: number | null): HTMLInputElement {
    const input = el('input', {
      type: 'number',
      inputmode: 'numeric',
      step: '1',
      min: '0',
      class: 'input input-price',
      id: `filter-${field}`,
      'aria-label': label,
      value: value === null ? '' : String(value),
    }) as HTMLInputElement;
    this.priceErrors.set(field, el('p', { class: 'field-error', id: `filter-${field}-error` }));
    input.addEventListener('input', () => this.onPriceInput());
    return input;
  }

  private buildGroup(group: Group): HTMLElement {
    const error = el('p', { class: 'field-error' });
    this.groupErrors.set(group.name, error);
    const chips = FACET_VALUES[group.name].map((value) => {
      const id = `chip-${group.name}-${value}`;
      const input = el('input', { type: 'checkbox', class: 'chip-input', id }) as HTMLInputElement;
      input.checked = this.filters[group.name].includes(value);
      const text = el('span', { class: 'chip-text' });
      const label = el('label', { class: 'chip', for: id }, [icon('check', 'chip-check'), text]);
      input.setAttribute('aria-label', `${group.label(value)} (0)`);
      input.addEventListener('change', () => this.toggle(group, value, input));
      this.chips.set(`${group.name}:${value}`, input);
      this.chipLabels.set(`${group.name}:${value}`, text);
      return el('div', { class: 'chip-wrap' }, [input, label]);
    });
    return el('fieldset', { class: 'filter-group', role: 'group', 'aria-label': group.title }, [
      el('legend', { text: group.title }),
      el('div', { class: 'chips' }, chips),
      error,
    ]);
  }

  private toggle(group: Group, value: string, input: HTMLInputElement): void {
    if (this.unavailable) {
      input.checked = this.filters[group.name].includes(value);
      return;
    }
    const current = this.filters[group.name];
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
    if (next.length > FACET_VALUE_LIMIT) {
      input.checked = current.includes(value);
      this.setGroupError(group.name, FIELD_MESSAGES.facetTooMany);
      return;
    }
    this.setGroupError(group.name, null);
    this.filters = { ...this.filters, [group.name]: next };
    input.checked = next.includes(value);
    this.settleNow();
  }

  private onTextInput(): void {
    if (this.unavailable) {
      this.searchBox.value = this.filters.q;
      return;
    }
    const value = this.searchBox.value;
    if (value.length > SEARCH_TEXT_LIMIT) {
      this.setError(this.searchBox, this.searchError, FIELD_MESSAGES.qTooLong);
      window.clearTimeout(this.settleTimer);
      return;
    }
    this.setError(this.searchBox, this.searchError, null);
    this.filters = { ...this.filters, q: value };
    this.settleSoon();
  }

  private onPriceInput(): void {
    if (this.unavailable) return;
    window.clearTimeout(this.settleTimer);
    const readBound = (input: HTMLInputElement, field: 'priceMin' | 'priceMax'): number | null | 'invalid' => {
      const text = input.value.trim();
      const error = this.priceErrors.get(field) as HTMLElement;
      if (text === '') {
        this.setError(input, error, null);
        return null;
      }
      if (!/^[0-9]+$/.test(text)) {
        this.setError(input, error, FIELD_MESSAGES.priceBound);
        return 'invalid';
      }
      this.setError(input, error, null);
      return Number(text);
    };
    const min = readBound(this.lowest, 'priceMin');
    const max = readBound(this.highest, 'priceMax');
    if (min === 'invalid' || max === 'invalid') return;
    if (min !== null && max !== null && min > max) {
      this.setError(this.lowest, this.priceErrors.get('priceMin') as HTMLElement, FIELD_MESSAGES.priceMinAboveMax);
      return;
    }
    this.filters = { ...this.filters, priceMin: min, priceMax: max };
    this.settleSoon();
  }

  private setError(input: HTMLInputElement, error: HTMLElement, message: string | null): void {
    error.textContent = message ?? '';
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', error.id);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  private setGroupError(name: FacetName, message: string | null): void {
    const node = this.groupErrors.get(name);
    if (node) node.textContent = message ?? '';
  }

  private settleSoon(): void {
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.options.onSettled({ ...this.filters }), SETTLE_MS);
  }

  private settleNow(): void {
    window.clearTimeout(this.settleTimer);
    this.options.onSettled({ ...this.filters });
  }

  private clear(): void {
    if (this.unavailable) return;
    this.filters = { q: '', bedrooms: [], band: [], facing: [], view: [], status: [], priceMin: null, priceMax: null };
    this.searchBox.value = '';
    this.lowest.value = '';
    this.highest.value = '';
    for (const chip of this.chips.values()) chip.checked = false;
    for (const group of GROUPS) this.setGroupError(group.name, null);
    this.settleNow();
  }

  /** Puts the controls back to what the address says, without running a search. */
  setFilters(filters: SearchFilters): void {
    this.filters = { ...filters };
    this.searchBox.value = filters.q;
    this.lowest.value = filters.priceMin === null ? '' : String(filters.priceMin);
    this.highest.value = filters.priceMax === null ? '' : String(filters.priceMax);
    for (const [key, input] of this.chips) {
      const [name, value] = key.split(':') as [FacetName, string];
      input.checked = filters[name].includes(value);
    }
  }

  current(): SearchFilters {
    return { ...this.filters };
  }

  setCounts(facets: Record<FacetName, Record<string, number>>): void {
    for (const group of GROUPS) {
      for (const value of FACET_VALUES[group.name]) {
        const count = facets[group.name]?.[value] ?? 0;
        const name = `${group.label(value)} (${count})`;
        this.chipLabels.get(`${group.name}:${value}`)?.replaceChildren(document.createTextNode(name));
        this.chips.get(`${group.name}:${value}`)?.setAttribute('aria-label', name);
      }
    }
  }

  /** During a search outage every control keeps its state and ignores input. */
  setUnavailable(unavailable: boolean): void {
    this.unavailable = unavailable;
    for (const node of this.node.querySelectorAll<HTMLElement>('input, button')) {
      if (unavailable) node.setAttribute('aria-disabled', 'true');
      else node.removeAttribute('aria-disabled');
    }
  }
}
