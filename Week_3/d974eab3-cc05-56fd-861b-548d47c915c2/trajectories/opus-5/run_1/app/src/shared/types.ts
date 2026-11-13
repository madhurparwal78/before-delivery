export type Mode = 'on' | 'off';

export type InterviewCategory = 'expert' | 'everyday';

export interface Pack {
  sticks: number;
  price_yen: number;
}

export interface Ingredient {
  name: string;
  mg: number;
}

export interface StoreLink {
  name: string;
  url: string;
}

export interface Product {
  name: string;
  format: string;
  serving: string;
  packs: Pack[];
  ingredients: Ingredient[];
  how_to_use: string[];
  storage: string;
  cautions: string[];
  stores: StoreLink[];
}

export interface InterviewAnswer {
  question: string;
  answer: string;
}

export interface Interview {
  slug: string;
  name: string;
  role: string;
  category: InterviewCategory;
  lede: string;
  hue: number;
  answers: InterviewAnswer[];
}

export interface Scenario {
  id: string;
  mode: Mode;
  name: string;
  title: string;
  time: string;
  copy: string;
  moment: string;
}

/** The interview fields published by `GET /api/content`. */
export type InterviewSummary = Omit<Interview, 'answers'>;

/** The scenario fields published by `GET /api/content`. */
export interface ScenarioSummary {
  id: string;
  mode: Mode;
  name: string;
}

export interface ContentResponse {
  edition: number;
  product: Product;
  interviews: InterviewSummary[];
  scenarios: ScenarioSummary[];
}

export interface InterviewNeighbour {
  slug: string;
  name: string;
}

export interface InterviewResponse extends Interview {
  previous: InterviewNeighbour | null;
  next: InterviewNeighbour | null;
}

export interface PanelCopy {
  title: string;
  text: string;
}

export interface StageCopy {
  name: string;
  title: string;
  text: string;
}

export interface DisclosureCopy {
  title: string;
  text: string;
}

export interface NitrateStepCopy {
  name: string;
  text: string;
}

/** The fixed site copy: the same in every edition. */
export interface SiteCopy {
  opening: { heading: string; line: string };
  about: { heading: string; lead: string; panels: PanelCopy[] };
  oxygen: { heading: string; stages: StageCopy[] };
  science: {
    heading: string;
    lead: string;
    disclosures: DisclosureCopy[];
    steps: NitrateStepCopy[];
  };
  interviews: { heading: string; note: string };
  lifestyle: { heading: string; lead: string };
  footer: { name: string; line: string; copyright: string };
  contact: { heading: string; care: string; phone: string; email: string };
  privacy: { heading: string; body: string };
  legal: { heading: string; body: string };
}

export interface ContentRecord {
  edition: number;
  product: Product;
  interviews: Interview[];
  scenarios: Scenario[];
  site: SiteCopy;
}
