import type { Mode, ScenarioId } from "./scenarios.js";

export interface Pack { sticks: number; price_yen: number }
export interface Ingredient { name: string; mg: number }
export interface Retailer { name: string; url: string }

export interface Product {
  name: string;
  format: string;
  serving: string;
  packs: Pack[];
  ingredients: Ingredient[];
  how_to_use: string[];
  storage: string;
  cautions: string[];
  stores: Retailer[];
}

export type InterviewCategory = "expert" | "everyday";

export interface Answer { question: string; answer: string }
export interface InterviewLink { slug: string; name: string }

export interface InterviewSummary {
  slug: string;
  name: string;
  role: string;
  category: InterviewCategory;
  lede: string;
  hue: number;
}

export interface Interview extends InterviewSummary { answers: Answer[] }

export interface InterviewDetail extends Interview {
  previous: InterviewLink | null;
  next: InterviewLink | null;
}

export interface Scenario {
  id: ScenarioId;
  mode: Mode;
  name: string;
  title: string;
  time: string;
  copy: string;
  moment: string;
}

interface ScenarioSummary { id: ScenarioId; mode: Mode; name: string }

/** The published record as the grading route replaces it and Postgres stores it. */
export interface ContentRecord {
  product: Product;
  interviews: Interview[];
  scenarios: Scenario[];
}

/** What GET /api/content answers. */
export interface Content {
  edition: number;
  product: Product;
  interviews: InterviewSummary[];
  scenarios: ScenarioSummary[];
}
