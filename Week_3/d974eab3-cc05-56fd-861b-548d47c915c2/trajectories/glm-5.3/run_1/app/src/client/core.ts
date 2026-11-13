export interface Pack {
  sticks: number;
  price_yen: number;
}

export interface Ingredient {
  name: string;
  mg: number;
}

export interface Store {
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
  stores: Store[];
}

export interface InterviewSummary {
  slug: string;
  name: string;
  role: string;
  category: 'expert' | 'everyday';
  lede: string;
  hue: number;
}

export interface ScenarioSummary {
  id: string;
  mode: 'on' | 'off';
  name: string;
}

export interface ScenarioRecord {
  id: string;
  mode: 'on' | 'off';
  name: string;
  title: string;
  time: string;
  copy: string;
  moment: string;
}

export interface Content {
  edition: number;
  product: Product;
  interviews: InterviewSummary[];
  scenarios: ScenarioSummary[];
}

export interface InterviewDetail {
  slug: string;
  name: string;
  role: string;
  category: 'expert' | 'everyday';
  lede: string;
  hue: number;
  answers: { question: string; answer: string }[];
  previous: { slug: string; name: string } | null;
  next: { slug: string; name: string } | null;
}

export const CHAPTERS = ['opening', 'about', 'oxygen', 'science', 'product', 'interviews', 'lifestyle'] as const;

export const SCENARIO_ORDER = [
  'on-work',
  'on-sports',
  'on-hobby',
  'on-housework',
  'off-break',
  'off-holiday',
  'off-relax',
  'off-rest',
] as const;

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatYen(value: number): string {
  return `¥${formatNumber(value)}`;
}

export function packLine(pack: Pack): string {
  return `${pack.sticks} sticks: ${formatYen(pack.price_yen)} (tax included)`;
}

export function ingredientAmount(mg: number): string {
  return `${formatNumber(mg)} mg`;
}

export function notAMedicine(product: Pick<Product, 'name'>): string {
  return `${product.name} is a food. It is not a medicine and is not intended to diagnose, treat, cure or prevent any disease.`;
}

export function editionLine(edition: number): string {
  return `Content edition ${edition}`;
}

export function productLine(product: Product): string {
  return `${product.format}. ${product.serving}.`;
}

export function modeOf(scenarioId: string): 'on' | 'off' {
  return scenarioId.startsWith('off') ? 'off' : 'on';
}

export function scenariosOfMode(scenarios: ScenarioSummary[], mode: 'on' | 'off'): ScenarioSummary[] {
  return SCENARIO_ORDER.flatMap((id) => {
    const scenario = scenarios.find((item) => item.id === id && item.mode === mode);
    return scenario ? [scenario] : [];
  });
}

export function announceStatus(message: string): void {
  const status = document.querySelector<HTMLElement>('[data-status]');
  if (!status) return;
  status.textContent = message;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
