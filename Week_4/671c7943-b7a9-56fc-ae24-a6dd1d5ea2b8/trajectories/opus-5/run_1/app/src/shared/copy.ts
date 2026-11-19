import type { BudgetId, ProjectTypeId } from './types.js';

export const STUDIO_EMAIL_ADDRESS = 'studio@sollis.example';
export const DESCRIPTION_LIMIT = 2000;

export interface Option<Id extends string> {
  id: Id;
  name: string;
}

export const PROJECT_TYPES: readonly Option<ProjectTypeId>[] = [
  { id: 'brand-identity', name: 'Brand Identity' },
  { id: 'website-design', name: 'Website Design' },
  { id: 'digital-product-design', name: 'Digital Product Design' },
  { id: 'not-sure', name: 'Not sure yet' },
];

export const BUDGETS: readonly Option<BudgetId>[] = [
  { id: 'under-10k', name: 'Under €10,000' },
  { id: '10k-25k', name: '€10,000 to €25,000' },
  { id: '25k-50k', name: '€25,000 to €50,000' },
  { id: 'over-50k', name: 'Over €50,000' },
];

export const BUDGET_PLACEHOLDER = 'Choose a budget range';

export function formatFigure(value: number): string {
  const whole = Math.trunc(value);
  if (Math.abs(whole) < 1000) return String(whole);
  return whole.toLocaleString('en-GB');
}

export function projectTypeName(id: ProjectTypeId): string {
  return PROJECT_TYPES.find((option) => option.id === id)!.name;
}

export function budgetName(id: BudgetId): string {
  return BUDGETS.find((option) => option.id === id)!.name;
}

export function firstName(name: string): string {
  const space = name.indexOf(' ');
  return space === -1 ? name : name.slice(0, space);
}

export const descriptionCounter = (count: number): string =>
  `${formatFigure(count)} of ${formatFigure(DESCRIPTION_LIMIT)} characters`;

export const filterAnnouncement = (count: number, categoryName: string | null): string => {
  if (categoryName === null) return `Showing ${count} projects.`;
  if (count === 0) return `No projects in ${categoryName} yet.`;
  if (count === 1) return `Showing 1 project in ${categoryName}.`;
  return `Showing ${count} projects in ${categoryName}.`;
};

export const emptyCategoryNotice = (categoryName: string): string =>
  `No projects in ${categoryName} yet.`;

export const showcaseAnnouncement = (screen: number, total: number, caption: string): string =>
  `Screen ${screen} of ${total}: ${caption}.`;

export const ENQUIRY_COPY = {
  errorHeading: 'There is a problem with your enquiry',
  sending: 'Sending your enquiry.',
  sentStatus: (reference: string): string => `Enquiry ${reference} sent.`,
  savedStatus: (reference: string): string => `Enquiry ${reference} saved.`,
  thanks: (name: string): string => `Thank you, ${firstName(name)}.`,
  thanksLine: (reference: string): string =>
    `Your enquiry ${reference} is with Maren. She will reply within two working days.`,
  mailFailedAlert: (reference: string): string =>
    `Your enquiry ${reference} is saved, but we could not send the confirmation email. Maren will still reply within two working days.`,
  notSavedAlert: `We could not send your enquiry. Please try again, or email ${STUDIO_EMAIL_ADDRESS}.`,
  downloadLink: 'Download your brief (PDF)',
  sendAnother: 'Send another enquiry',
  summaryHeading: 'Your enquiry',
} as const;
