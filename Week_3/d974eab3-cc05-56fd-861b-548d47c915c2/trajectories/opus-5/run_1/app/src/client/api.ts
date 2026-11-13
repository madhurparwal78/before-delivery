import { SHEET_FILENAME } from '../shared/messages';
import type {
  ContentResponse,
  InterviewResponse,
  Scenario,
} from '../shared/types';

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${path} answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

export function fetchContent(): Promise<ContentResponse> {
  return readJson<ContentResponse>('/api/content');
}

export function fetchScenario(id: string): Promise<Scenario> {
  return readJson<Scenario>(`/api/scenarios/${id}`);
}

export function fetchInterview(slug: string): Promise<InterviewResponse> {
  return readJson<InterviewResponse>(`/api/interviews/${slug}`);
}

export interface SheetFile {
  blob: Blob;
  filename: string;
}

function filenameFrom(header: string | null): string {
  return /filename="([^"]+)"/.exec(header ?? '')?.[1] ?? SHEET_FILENAME;
}

/** Asks for a fresh product sheet, or null when the print service is out. */
export async function fetchProductSheet(): Promise<SheetFile | null> {
  try {
    const response = await fetch('/api/product/sheet');
    if (!response.ok) {
      return null;
    }
    return {
      blob: await response.blob(),
      filename: filenameFrom(response.headers.get('content-disposition')),
    };
  } catch {
    return null;
  }
}
