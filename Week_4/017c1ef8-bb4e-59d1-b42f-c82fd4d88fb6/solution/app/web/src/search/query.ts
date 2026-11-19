import type { JobCard, PersonCard, Post } from '../types';

export type SearchType = 'people' | 'posts' | 'jobs';

export const SEARCH_TYPES: Array<{ type: SearchType; label: string }> = [
  { type: 'people', label: 'People' },
  { type: 'posts', label: 'Posts' },
  { type: 'jobs', label: 'Jobs' },
];

export interface PeopleFilters {
  degrees: Array<'1' | '2' | '3'>;
  company: string;
  location: string;
}

export interface JobFilters {
  location: string;
  workplace: '' | 'on-site' | 'hybrid' | 'remote';
  posted: '' | 'day' | 'week' | 'month';
}

interface SearchResponse<Result> {
  type: SearchType;
  q: string;
  total: number;
  results: Result[];
  next_cursor: string | null;
}

export type AnyResponse = SearchResponse<PersonCard> | SearchResponse<Post> | SearchResponse<JobCard>;

export const typeOf = (value: string | null): SearchType => (value === 'posts' || value === 'jobs' ? value : 'people');

/** The request for one search: the same text, tab and filters always make the same path. */
export function searchPath(type: SearchType, q: string, people: PeopleFilters, jobs: JobFilters, cursor?: string): string {
  const params = new URLSearchParams({ type, q });
  if (type === 'people') {
    if (people.degrees.length > 0) params.set('degree', people.degrees.join(','));
    if (people.company) params.set('company', people.company);
    if (people.location) params.set('location', people.location);
  }
  if (type === 'jobs') {
    if (jobs.location) params.set('location', jobs.location);
    if (jobs.workplace) params.set('workplace', jobs.workplace);
    if (jobs.posted) params.set('posted', jobs.posted);
  }
  if (cursor) params.set('cursor', cursor);
  return `/api/search?${params.toString()}`;
}

/** The count text the brief publishes for a result list. */
export function countText(total: number, q: string): string {
  if (total === 0 && q.trim() !== '') return `No results for “${q}”`;
  return total === 1 ? '1 result' : `${total.toLocaleString('en-US')} results`;
}
