/** The catalog's wire format: the published API and the page's boot data use these field names. */

export interface Colours {
  ground: string;
  ink: string;
  accent: string;
}

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

interface GalleryImage {
  n: number;
  caption: string;
  src: string;
}

interface CaseSections {
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
  industry: string;
  services: string[];
  world_slug: string | null;
  colours: Colours;
  display_face: string;
  body_face: string;
  sections: CaseSections;
  gallery: GalleryImage[];
  deliverables: string[];
}

export interface DesignDecision {
  title: string;
  text: string;
}

export interface World {
  slug: string;
  name: string;
  index: number;
  industry_id: string;
  industry: string;
  services: string[];
  summary: string;
  overview: string;
  decisions: DesignDecision[];
  colours: Colours;
  display_face: string;
  deliverables: string[];
  yaw: number;
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

interface Principle {
  name: string;
  text: string;
}

interface Person {
  name: string;
  role: string;
  line: string;
}

export interface Studio {
  principles: Principle[];
  people: Person[];
  stages: Principle[];
}

export interface Catalog {
  industries: Industry[];
  services: Service[];
  projects: Project[];
  worlds: World[];
  prices: PriceItem[];
  questions: Question[];
  studio: Studio;
}

export type ProjectListItem = Pick<Project, "slug" | "name" | "industry_id" | "industry" | "services" | "world_slug">;

export interface ProjectPage {
  total: number;
  items: ProjectListItem[];
  next_offset: number | null;
}

/** What the server embeds in every page: the catalog, the first gallery page and the two limit values the copy needs. */
export interface Boot {
  catalog: Catalog;
  firstPage: ProjectPage;
  enquiryLimit: number;
  enquiryWindowSeconds: number;
}

export interface EnquiryAnswers {
  name: string;
  email: string;
  business_name: string;
  service: string;
  description: string;
  budget: string;
  item: string | null;
}

export type FieldErrors = Partial<Record<keyof EnquiryAnswers | "submission_id", string>>;
