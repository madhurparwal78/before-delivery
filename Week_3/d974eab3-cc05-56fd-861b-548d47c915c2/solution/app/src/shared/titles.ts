/** Page titles and addresses: the server writes them into the document, the browser keeps them while it navigates. */
export const BRAND = "Vireo Pace";
export const COMPANY = "Alder Quay Laboratories";

export const PAGE_TITLES = {
  story: `${BRAND} | ${COMPANY}`,
  store: `Online store | ${BRAND}`,
  contact: `Contact | ${COMPANY}`,
  privacy: `Privacy | ${COMPANY}`,
  legal: `Legal | ${COMPANY}`,
  notFound: `Not found | ${BRAND}`,
} as const;

export function interviewTitle(name: string): string {
  return `${name} | ${BRAND} interviews`;
}

/** The pages with a fixed address. */
export const PAGE_PATHS = {
  "/": "story",
  "/store": "store",
  "/contact": "contact",
  "/privacy": "privacy",
  "/legal": "legal",
} as const;

export type PageName = (typeof PAGE_PATHS)[keyof typeof PAGE_PATHS];

const INTERVIEW_PATH = /^\/interviews\/([^/]+)$/;

export function interviewHref(slug: string): string {
  return `/interviews/${slug}`;
}

/** An address segment as text; a broken percent escape stays as it was written. */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The slug of an `/interviews/<slug>` address, or null for any other address. */
export function interviewSlugOf(pathname: string): string | null {
  const segment = INTERVIEW_PATH.exec(pathname)?.[1];
  return segment === undefined ? null : decodeSegment(segment);
}
