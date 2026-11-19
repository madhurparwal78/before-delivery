export type CategoryId = "brand-identity" | "website-design" | "digital-product-design";

export type Motif = "arcs" | "grid" | "stack";

export interface PaletteColour {
  name: string;
  hex: string;
}

export interface Screen {
  caption: string;
}

export interface Result {
  value: string;
  label: string;
}

export interface Project {
  slug: string;
  title: string;
  client: string;
  category: CategoryId;
  year: number;
  hue: number;
  motif: Motif;
  role: string;
  duration: string;
  standfirst: string;
  overview: string;
  objectives: string[];
  palette: PaletteColour[];
  screens: Screen[];
  process: number[];
  results: Result[];
}

export interface StatisticPart {
  label: string;
  value: number;
}

export interface Statistic {
  id: string;
  value: number;
  label: string;
  note: string;
  parts: StatisticPart[];
}

export interface Content {
  projects: Project[];
  stats: Statistic[];
}

export const CATEGORY_IDS: CategoryId[] = ["brand-identity", "website-design", "digital-product-design"];

export const CATEGORY_NAMES: Record<CategoryId, string> = {
  "brand-identity": "Brand Identity",
  "website-design": "Website Design",
  "digital-product-design": "Digital Product Design",
};

export type BudgetId = "under-10k" | "10k-25k" | "25k-50k" | "over-50k";

export interface BudgetOption {
  id: BudgetId;
  name: string;
}

export const BUDGET_OPTIONS: BudgetOption[] = [
  { id: "under-10k", name: "Under €10,000" },
  { id: "10k-25k", name: "€10,000 to €25,000" },
  { id: "25k-50k", name: "€25,000 to €50,000" },
  { id: "over-50k", name: "Over €50,000" },
];

export const PROJECT_TYPES: { id: CategoryId | "not-sure"; name: string }[] = [
  { id: "brand-identity", name: "Brand Identity" },
  { id: "website-design", name: "Website Design" },
  { id: "digital-product-design", name: "Digital Product Design" },
  { id: "not-sure", name: "Not sure yet" },
];

export function budgetName(id: string): string {
  const option = BUDGET_OPTIONS.find((o) => o.id === id);
  return option ? option.name : "";
}

export function projectTypeName(id: string): string {
  const option = PROJECT_TYPES.find((t) => t.id === id);
  return option ? option.name : "";
}

export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_IDS as string[]).includes(value);
}

export function isProjectTypeId(value: string): value is CategoryId | "not-sure" {
  return (PROJECT_TYPES.map((t) => t.id) as string[]).includes(value);
}

export function isBudgetId(value: string): value is BudgetId {
  return (BUDGET_OPTIONS.map((o) => o.id) as string[]).includes(value);
}
