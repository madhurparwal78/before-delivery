import type { Issue, Markup, Rfi, VersionSummary } from '../../shared/types.ts';

interface ReviewState {
  issues: readonly Issue[];
  rfis: readonly Rfi[];
  /** published versions by sheet id, oldest first */
  versions: Readonly<Record<string, readonly VersionSummary[]>>;
  /** markups by version id */
  markups: Readonly<Record<string, readonly Markup[]>>;
  /** the sentence a review action or a review message left for a version (refusals, voiding) */
  notes: Readonly<Record<string, string>>;
}

type ReviewAction =
  | { type: 'issues'; issues: readonly Issue[]; rfis: readonly Rfi[] }
  | { type: 'issue'; issue: Issue }
  | { type: 'rfi'; rfi: Rfi; issue?: Issue }
  | { type: 'versions'; sheetId: string; versions: readonly VersionSummary[] }
  | { type: 'markups'; versionId: string; markups: readonly Markup[] }
  | { type: 'markup'; markup: Markup }
  | { type: 'note'; versionId: string; text: string | null };

export const initialReviewState: ReviewState = { issues: [], rfis: [], versions: {}, markups: {}, notes: {} };

function upsert<T extends { id: string }>(list: readonly T[], item: T): readonly T[] {
  return list.some((entry) => entry.id === item.id) ? list.map((entry) => (entry.id === item.id ? item : entry)) : [...list, item];
}

/** The fetched items, then those that only arrived live meanwhile. */
function merge<T extends { id: string }>(fetched: readonly T[], known: readonly T[]): readonly T[] {
  return [...fetched, ...known.filter((item) => !fetched.some((other) => other.id === item.id))];
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'issues':
      return { ...state, issues: merge(action.issues, state.issues), rfis: merge(action.rfis, state.rfis) };
    case 'issue':
      return { ...state, issues: upsert(state.issues, action.issue) };
    case 'rfi':
      return { ...state, rfis: upsert(state.rfis, action.rfi), issues: action.issue ? upsert(state.issues, action.issue) : state.issues };
    case 'versions':
      return { ...state, versions: { ...state.versions, [action.sheetId]: action.versions } };
    case 'markups':
      return { ...state, markups: { ...state.markups, [action.versionId]: merge(action.markups, state.markups[action.versionId] ?? []) } };
    case 'markup':
      return { ...state, markups: { ...state.markups, [action.markup.version_id]: upsert(state.markups[action.markup.version_id] ?? [], action.markup) } };
    case 'note': {
      const notes = { ...state.notes };
      if (action.text === null) delete notes[action.versionId];
      else notes[action.versionId] = action.text;
      return { ...state, notes };
    }
  }
}
