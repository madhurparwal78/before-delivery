export type CategoryId = 'brand-identity' | 'website-design' | 'digital-product-design';

export type Motif = 'arcs' | 'grid' | 'stack';

export interface PaletteColour {
  name: string;
  hex: string;
}

export interface ProjectScreen {
  caption: string;
}

export interface ProjectResult {
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
  screens: ProjectScreen[];
  process: number[];
  results: ProjectResult[];
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

export type ProjectTypeId = CategoryId | 'not-sure';

export type BudgetId = 'under-10k' | '10k-25k' | '25k-50k' | 'over-50k';

export type MailOutcome = 'sent' | 'not_sent';

export interface StoredEnquiry {
  reference: string;
  name: string;
  email: string;
  projectType: ProjectTypeId;
  budget: BudgetId;
  description: string;
  mail: MailOutcome;
  briefToken: string;
}
