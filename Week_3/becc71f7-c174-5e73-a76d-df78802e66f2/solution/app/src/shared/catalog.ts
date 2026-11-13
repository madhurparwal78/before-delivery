// The published option lists, each value beside the label shown for it.

export interface Option<V extends string = string> {
  value: V;
  label: string;
}

export const CATEGORIES = [
  { value: "coats", label: "Coats" },
  { value: "jackets", label: "Jackets" },
  { value: "dresses", label: "Dresses" },
  { value: "knitwear", label: "Knitwear" },
  { value: "shirts", label: "Shirts" },
  { value: "trousers", label: "Trousers" },
  { value: "skirts", label: "Skirts" },
  { value: "shoes", label: "Shoes" },
  { value: "bags", label: "Bags" },
  { value: "accessories", label: "Accessories" },
] as const;

const NUMBER_SIZES = [36, 37, 38, 39, 40, 41, 42, 43, 44, 45].map((size) => ({ value: String(size), label: String(size) }));

export const SIZES: readonly Option[] = [
  { value: "xs", label: "XS" },
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
  ...NUMBER_SIZES,
  { value: "one_size", label: "One size" },
];

export const CONDITIONS = [
  { value: "excellent", label: "Excellent" },
  { value: "very_good", label: "Very good" },
  { value: "good", label: "Good" },
] as const;

export const PRICE_BANDS = [
  { value: "under-50", label: "Under €50" },
  { value: "50-100", label: "€50 to €100" },
  { value: "100-200", label: "€100 to €200" },
  { value: "200-plus", label: "€200 and over" },
] as const;

export const PIECE_STATUSES = [
  { value: "on_rail", label: "On the rail" },
  { value: "on_hold", label: "On hold" },
  { value: "sold", label: "Sold" },
  { value: "returns_shelf", label: "Returns shelf" },
  { value: "donation_box", label: "Donation box" },
  { value: "returned", label: "Returned" },
  { value: "archived", label: "Archived" },
] as const;

export const ROLES = [
  { value: "owner", label: "Shop owner" },
  { value: "assistant", label: "Shop assistant" },
  { value: "bookkeeper", label: "Bookkeeper" },
] as const;

export const CONSIGNOR_STATUSES = [
  { value: "active", label: "Active" },
  { value: "erasing", label: "Erasing" },
  { value: "erased", label: "Erased" },
] as const;

export type Category = (typeof CATEGORIES)[number]["value"];
export type Condition = (typeof CONDITIONS)[number]["value"];
export type PieceStatus = (typeof PIECE_STATUSES)[number]["value"];
export type Role = (typeof ROLES)[number]["value"];
export type ConsignorStatus = (typeof CONSIGNOR_STATUSES)[number]["value"];

export function labelOf(options: readonly Option[], value: string): string {
  return options.filter((option) => option.value === value)[0].label;
}

export const SHOP_ADDRESS = "Rue de l'Ourlet 12, 1000 Brussels";
export const HELD_BACK_REASON = "No valid IBAN on file — held back until the next run.";
export const SESSION_ENDED_COPY = "Your session ended. Sign in again to keep going — what you typed is still here.";
