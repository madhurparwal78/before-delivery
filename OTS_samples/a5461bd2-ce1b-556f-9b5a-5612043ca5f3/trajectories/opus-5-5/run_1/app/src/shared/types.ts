export interface Industry {
  id: string;
  name: string;
}

export interface ProcessStep {
  name: string;
  text: string;
}

export interface Service {
  id: string;
  name: string;
  purpose: string;
  deliverables: string[];
  steps: ProcessStep[];
}

export interface Colours {
  ground: string;
  ink: string;
  accent: string;
}

export interface DesignDecision {
  title: string;
  text: string;
}

export interface WorldCopy {
  index: number;
  summary: string;
  overview: string;
  decisions: DesignDecision[];
}

export interface CaseStudySections {
  brief: string;
  strategy: string;
  identity: string;
  digital_design: string;
  implementation: string;
}

export interface Project {
  slug: string;
  name: string;
  industry_id: string;
  services: string[];
  colours: Colours;
  display_face: string;
  body_face: string;
  sections: CaseStudySections;
  captions: string[];
  deliverables: string[];
  world: WorldCopy | null;
}

export type PriceType = "fixed" | "custom";

export interface PriceItem {
  id: string;
  category: string;
  name: string;
  type: PriceType;
  price_text: string;
  delivery: string;
  revisions: string;
  inclusions: string[];
}

export interface Question {
  id: string;
  question: string;
  answer: string[];
}

export interface Content {
  industries: Industry[];
  services: Service[];
  projects: Project[];
  prices: PriceItem[];
  questions: Question[];
}

export interface ClientSettings {
  enquiryLimit: number;
  enquiryWindowSeconds: number;
  workPageSize: number;
}

export interface Bootstrap {
  content: Content;
  settings: ClientSettings;
}
