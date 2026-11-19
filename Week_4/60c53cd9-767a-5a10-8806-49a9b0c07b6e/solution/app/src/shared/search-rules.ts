/** The search input bounds and the finder-address rules, decided once for the API and the browser. */
import { BANDS, BEDROOM_VALUES, FACINGS, STATUSES, VIEW_TAGS } from "./domain.js";
import { FIELD_MESSAGES } from "./copy.js";

const Q_LIMIT = 80;
export const FACET_LIMIT = 6;
const PRICE_MAX_BOUND = 100_000_000;
/** The default page size, which is also the most a request may ask for. */
export const PAGE_SIZE = 24;

export const FACET_NAMES = ["bedrooms", "band", "facing", "view", "status"] as const;
export type FacetName = (typeof FACET_NAMES)[number];

export const FACET_VALUES: Readonly<Record<FacetName, readonly string[]>> = {
  bedrooms: BEDROOM_VALUES,
  band: BANDS,
  facing: FACINGS,
  view: VIEW_TAGS,
  status: STATUSES,
};

export interface SearchFilters {
  q: string;
  bedrooms: string[];
  band: string[];
  facing: string[];
  view: string[];
  status: string[];
  priceMin: string;
  priceMax: string;
}

export const emptyFilters = (): SearchFilters => ({
  q: "",
  bedrooms: [],
  band: [],
  facing: [],
  view: [],
  status: [],
  priceMin: "",
  priceMax: "",
});

export type FieldErrors = Partial<Record<keyof SearchFilters | "limit" | "after", string>>;

const WHOLE_NUMBER = /^\d{1,15}$/;

const isWholePrice = (text: string): boolean => WHOLE_NUMBER.test(text) && Number(text) <= PRICE_MAX_BOUND;

/** Field-level messages for search input; an empty result means the input is valid. */
export const validateFilters = (filters: SearchFilters): FieldErrors => {
  const errors: FieldErrors = {};
  if ([...filters.q].length > Q_LIMIT) errors.q = FIELD_MESSAGES.q;
  for (const name of FACET_NAMES) {
    const values = filters[name];
    if (values.length > FACET_LIMIT) errors[name] = FIELD_MESSAGES.facetTooMany;
    else if (values.some((value) => !FACET_VALUES[name].includes(value))) errors[name] = FIELD_MESSAGES.facetUnknown;
  }
  const minValid = filters.priceMin === "" || isWholePrice(filters.priceMin);
  const maxValid = filters.priceMax === "" || isWholePrice(filters.priceMax);
  if (!minValid) errors.priceMin = FIELD_MESSAGES.price;
  if (!maxValid) errors.priceMax = FIELD_MESSAGES.price;
  if (minValid && maxValid && filters.priceMin !== "" && filters.priceMax !== "" && Number(filters.priceMin) > Number(filters.priceMax)) {
    errors.priceMin = FIELD_MESSAGES.priceOrder;
  }
  return errors;
};

export const isValidLimit = (text: string): boolean => /^\d{1,3}$/.test(text) && Number(text) >= 1 && Number(text) <= PAGE_SIZE;

const orderedValues = (name: FacetName, values: readonly string[]): string[] =>
  FACET_VALUES[name].filter((value) => values.includes(value));

/** Query pairs in address order, with facet values in the order the API lists them. */
export const filtersToPairs = (filters: SearchFilters): [string, string][] => {
  const pairs: [string, string][] = [];
  if (filters.q !== "") pairs.push(["q", filters.q]);
  for (const name of FACET_NAMES) for (const value of orderedValues(name, filters[name])) pairs.push([name, value]);
  if (filters.priceMin !== "") pairs.push(["priceMin", filters.priceMin]);
  if (filters.priceMax !== "") pairs.push(["priceMax", filters.priceMax]);
  return pairs;
};

/** Reads an address, dropping every invalid value as the finder rules require. */
export const filtersFromAddress = (params: URLSearchParams): SearchFilters => {
  const filters = emptyFilters();
  const q = params.get("q") ?? "";
  if ([...q].length <= Q_LIMIT) filters.q = q;
  for (const name of FACET_NAMES) {
    const values = params.getAll(name);
    if (values.length > FACET_LIMIT) continue;
    filters[name] = orderedValues(name, values);
  }
  const min = params.get("priceMin");
  const max = params.get("priceMax");
  const minOk = min !== null && isWholePrice(min);
  const maxOk = max !== null && isWholePrice(max);
  if (minOk) filters.priceMin = min;
  if (maxOk) filters.priceMax = max;
  if (minOk && maxOk && Number(min) > Number(max)) {
    filters.priceMin = "";
    filters.priceMax = "";
  }
  return filters;
};
