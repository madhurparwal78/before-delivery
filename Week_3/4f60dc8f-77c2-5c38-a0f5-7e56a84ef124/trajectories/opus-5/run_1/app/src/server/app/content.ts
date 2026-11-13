import type { CaseStudy, Service, StudioContent } from '../../shared/domain.js';
import { loadContent } from '../services/pocketbase.js';
import { documentsFor, replaceIndex } from '../services/search.js';

export type FullContent = StudioContent & { allCaseStudies: CaseStudy[] };

let lastKnown: FullContent | null = null;

export const studioContent = async (): Promise<FullContent> => {
  const content = await loadContent();
  lastKnown = content;
  return content;
};

/**
 * Service records shape every quote read, so they are fetched fresh; the last-known
 * snapshot keeps engagement reads working while PocketBase is away.
 */
export const servicesForRead = async (): Promise<Service[]> => {
  try {
    return (await studioContent()).services;
  } catch (error) {
    if (lastKnown !== null) return lastKnown.services;
    throw error;
  }
};

/** Pages keep rendering from the last-known content while PocketBase is away. */
export const contentForPage = async (): Promise<FullContent> => {
  try {
    return await studioContent();
  } catch (error) {
    if (lastKnown !== null) return lastKnown;
    throw error;
  }
};

export const publicCaseStudy = async (slug: string): Promise<CaseStudy | null> => {
  const content = await studioContent();
  return content.case_studies.find((study) => study.slug === slug) ?? null;
};

export const syncSearchIndex = async (content: FullContent): Promise<void> => {
  await replaceIndex(
    documentsFor({
      caseStudies: content.allCaseStudies,
      services: content.services,
      insights: content.insights,
    }),
  );
};

export const reindexFromPocketBase = async (): Promise<void> => {
  await syncSearchIndex(await studioContent());
};
