export type CategoryId = "brand-identity" | "website-design" | "digital-product-design";
export type ProjectTypeId = CategoryId | "not-sure";
export type BudgetId = "under-10k" | "10k-25k" | "25k-50k" | "over-50k";
export type Motif = "arcs" | "grid" | "stack";
export type MailOutcome = "sent" | "not_sent";

interface PaletteColour {
  name: string;
  hex: string;
}

interface Result {
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
  screens: { caption: string }[];
  process: [number, number, number, number];
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

export interface EnquiryValues {
  name: string;
  email: string;
  project_type: string;
  budget: string;
  description: string;
}

export type EnquiryField = keyof EnquiryValues;
export type EnquiryErrors = Partial<Record<EnquiryField | "submission_id", string>>;

export interface EnquiryAnswer {
  reference: string;
  brief_url: string;
  mail: MailOutcome;
}
