import type { Content, PriceItem, PriceType, Project } from "./types.js";

export const RING_SIZE = 8;
const DEGREES_PER_WORLD = 45;
export const DESCRIPTION_MAX = 1200;

export const budgets: ReadonlyArray<{ id: string; label: string }> = [
  { id: "under-50k", label: "Under ₹50,000" },
  { id: "50k-150k", label: "₹50,000 to ₹1,50,000" },
  { id: "150k-500k", label: "₹1,50,000 to ₹5,00,000" },
  { id: "above-500k", label: "Above ₹5,00,000" },
  { id: "not-sure", label: "Not sure yet" },
];

export function characterCount(value: string): number {
  return [...value].length;
}

export function groupDigits(n: number): string {
  return n.toLocaleString("en-US");
}

export function worldsOf(content: Content): Project[] {
  return content.projects
    .filter((p) => p.world !== null)
    .sort((a, b) => (a.world?.index ?? 0) - (b.world?.index ?? 0));
}

export function worldYaw(index: number): number {
  return (index - 1) * DEGREES_PER_WORLD;
}

export function industryName(content: Content, id: string): string {
  return content.industries.find((i) => i.id === id)?.name ?? "";
}

export function serviceNames(content: Content, ids: readonly string[]): string[] {
  return content.services.filter((s) => ids.includes(s.id)).map((s) => s.name);
}

export interface GalleryFilter {
  services: string[];
  industry: string | null;
}

function matchesServices(project: Project, services: readonly string[]): boolean {
  return services.length === 0 || project.services.some((s) => services.includes(s));
}

function matchesIndustry(project: Project, industry: string | null): boolean {
  return industry === null || project.industry_id === industry;
}

export function matchProjects(content: Content, filter: GalleryFilter): Project[] {
  return content.projects.filter(
    (p) => matchesServices(p, filter.services) && matchesIndustry(p, filter.industry),
  );
}

export interface GalleryCounts {
  services: Record<string, number>;
  industries: Record<string, number>;
  allIndustries: number;
}

export function galleryCounts(content: Content, filter: GalleryFilter): GalleryCounts {
  const byIndustry = content.projects.filter((p) => matchesIndustry(p, filter.industry));
  const byServices = content.projects.filter((p) => matchesServices(p, filter.services));
  const services: Record<string, number> = {};
  for (const s of content.services) services[s.id] = byIndustry.filter((p) => p.services.includes(s.id)).length;
  const industries: Record<string, number> = {};
  for (const i of content.industries) industries[i.id] = byServices.filter((p) => p.industry_id === i.id).length;
  return { services, industries, allIndustries: byServices.length };
}

export function sanitiseGalleryFilter(content: Content, services: readonly string[], industry: string | null): GalleryFilter {
  return {
    services: content.services.map((s) => s.id).filter((id) => services.includes(id)),
    industry: content.industries.some((i) => i.id === industry) ? industry : null,
  };
}

export interface PriceFilter {
  category: string | null;
  type: PriceType | null;
}

function matchesCategory(item: PriceItem, category: string | null): boolean {
  return category === null || item.category === category;
}

function matchesType(item: PriceItem, type: PriceType | null): boolean {
  return type === null || item.type === type;
}

export function matchPrices(content: Content, filter: PriceFilter): PriceItem[] {
  return content.prices.filter((i) => matchesCategory(i, filter.category) && matchesType(i, filter.type));
}

export interface PriceCounts {
  allCategories: number;
  categories: Record<string, number>;
  allTypes: number;
  types: Record<PriceType, number>;
}

export function priceCounts(content: Content, filter: PriceFilter): PriceCounts {
  const byType = content.prices.filter((i) => matchesType(i, filter.type));
  const byCategory = content.prices.filter((i) => matchesCategory(i, filter.category));
  const categories: Record<string, number> = {};
  for (const s of content.services) categories[s.id] = byType.filter((i) => i.category === s.id).length;
  return {
    allCategories: byType.length,
    categories,
    allTypes: byCategory.length,
    types: {
      fixed: byCategory.filter((i) => i.type === "fixed").length,
      custom: byCategory.filter((i) => i.type === "custom").length,
    },
  };
}

const enquiryFields = [
  "name",
  "email",
  "business_name",
  "service",
  "description",
  "budget",
  "item",
  "submission_id",
] as const;

export type EnquiryField = (typeof enquiryFields)[number];
export type EnquiryErrors = Partial<Record<EnquiryField, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function itemOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

type Rule = (input: Record<string, unknown>, content: Content) => string | null;

const fieldRules: Record<EnquiryField, Rule> = {
  name: (input) => {
    const v = text(input.name);
    if (v.trim() === "") return "Enter your name.";
    if (characterCount(v) > 80) return "Keep your name to 80 characters or fewer.";
    return null;
  },
  email: (input) => {
    const v = text(input.email);
    if (v.trim() === "") return "Enter your email address.";
    if (!EMAIL_PATTERN.test(v)) return "Enter an email address like name@example.com.";
    return null;
  },
  business_name: (input) => {
    const v = text(input.business_name);
    if (v.trim() === "") return "Enter your business name.";
    if (characterCount(v) > 120) return "Keep your business name to 120 characters or fewer.";
    return null;
  },
  service: (input, content) =>
    content.services.some((s) => s.id === text(input.service)) ? null : "Choose a service.",
  description: (input) => {
    const v = text(input.description);
    if (characterCount(v.trim()) < 30) return "Describe your project in at least 30 characters.";
    if (characterCount(v) > DESCRIPTION_MAX) return "Keep your description to 1,200 characters or fewer.";
    return null;
  },
  budget: (input) => (budgets.some((b) => b.id === text(input.budget)) ? null : "Choose an approximate budget."),
  item: (input, content) => {
    const item = itemOf(input.item);
    if (item === null) return null;
    return content.prices.some((p) => p.id === item && p.category === text(input.service))
      ? null
      : "Choose an item from the chosen service.";
  },
  submission_id: (input) => (UUID_V4_PATTERN.test(text(input.submission_id)) ? null : "Missing submission id."),
};

export function validateEnquiry(
  input: Record<string, unknown>,
  content: Content,
  fields: readonly EnquiryField[] = enquiryFields,
): EnquiryErrors {
  const errors: EnquiryErrors = {};
  for (const field of fields) {
    const message = fieldRules[field](input, content);
    if (message !== null) errors[field] = message;
  }
  return errors;
}
