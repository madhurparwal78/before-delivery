import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Issue, LiveMessage, Markup, Rfi, VersionSummary } from '../../shared/types.ts';
import { getJson } from '../api.ts';
import { toastRefusal } from '../toastRefusal.ts';
import { initialReviewState, reviewReducer } from './reviewState.ts';

interface ReviewData {
  issues: readonly Issue[];
  rfis: readonly Rfi[];
  versionsOf: (sheetId: string) => readonly VersionSummary[];
  /** every version of every loaded sheet, with its sheet id */
  allVersions: () => readonly (VersionSummary & { sheet_id: string })[];
  markupsOf: (versionId: string) => readonly Markup[];
  noteOf: (versionId: string) => string | null;
  /** fetches a version's markups once */
  loadMarkups: (versionId: string) => void;
  refreshVersions: (sheetId: string) => void;
  setNote: (versionId: string, text: string | null) => void;
  addIssue: (issue: Issue) => void;
  addRfi: (rfi: Rfi) => void;
  addMarkup: (markup: Markup) => void;
}

const ReviewDataContext = createContext<ReviewData | null>(null);

export function useReviewData(): ReviewData {
  const data = useContext(ReviewDataContext);
  if (data === null) throw new Error('useReviewData used outside ReviewDataProvider');
  return data;
}

interface ReviewDataProviderProps {
  drawingId: string;
  /** the sheets whose versions are listed */
  sheetIds: readonly string[];
  /** every live message of the drawing, after it was applied */
  subscribe: (listener: (message: LiveMessage) => void) => () => void;
  children: ReactNode;
}

/** Issues, RFIs, published versions and markups of a drawing: loaded once, then kept current by the live messages. */
export function ReviewDataProvider({ drawingId, sheetIds, subscribe, children }: ReviewDataProviderProps) {
  const [state, dispatch] = useReducer(reviewReducer, initialReviewState);
  const markupsRequested = useRef(new Set<string>());
  const sheetsRequested = useRef(new Set<string>());

  const refreshVersions = useCallback((sheetId: string): void => {
    void toastRefusal(async () => {
      const answer = await getJson<{ versions: VersionSummary[] }>(`/api/sheets/${sheetId}/versions`);
      dispatch({ type: 'versions', sheetId, versions: answer.versions });
    });
  }, []);

  useEffect(() => {
    let current = true;
    void toastRefusal(async () => {
      const answer = await getJson<{ issues: Issue[]; rfis: Rfi[] }>(`/api/drawings/${drawingId}/issues`);
      if (current) dispatch({ type: 'issues', issues: answer.issues, rfis: answer.rfis });
    });
    return () => {
      current = false;
    };
  }, [drawingId]);

  useEffect(() => {
    for (const sheetId of sheetIds) {
      if (sheetsRequested.current.has(sheetId)) continue;
      sheetsRequested.current.add(sheetId);
      refreshVersions(sheetId);
    }
  }, [sheetIds, refreshVersions]);

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'issue') dispatch({ type: 'issue', issue: message.data.issue });
        else if (message.type === 'rfi') dispatch({ type: 'rfi', rfi: message.data.rfi, issue: message.data.issue });
        else if (message.type === 'markup') dispatch({ type: 'markup', markup: message.data.markup });
        else if (message.type === 'version' && message.data.version) refreshVersions(message.data.version.sheet_id);
        else if (message.type === 'review') {
          dispatch({ type: 'note', versionId: message.data.version_id, text: message.data.message });
          refreshVersions(message.data.sheet_id);
        }
      }),
    [subscribe, refreshVersions],
  );

  const loadMarkups = useCallback((versionId: string): void => {
    if (markupsRequested.current.has(versionId)) return;
    markupsRequested.current.add(versionId);
    void toastRefusal(async () => {
      const answer = await getJson<{ markups: Markup[] }>(`/api/versions/${versionId}/markups`);
      dispatch({ type: 'markups', versionId, markups: answer.markups });
    });
  }, []);

  const data = useMemo<ReviewData>(
    () => ({
      issues: state.issues,
      rfis: state.rfis,
      versionsOf: (sheetId) => state.versions[sheetId] ?? [],
      allVersions: () => Object.entries(state.versions).flatMap(([sheetId, versions]) => versions.map((version) => ({ ...version, sheet_id: sheetId }))),
      markupsOf: (versionId) => state.markups[versionId] ?? [],
      noteOf: (versionId) => state.notes[versionId] ?? null,
      loadMarkups,
      refreshVersions,
      setNote: (versionId, text) => dispatch({ type: 'note', versionId, text }),
      addIssue: (issue) => dispatch({ type: 'issue', issue }),
      addRfi: (rfi) => dispatch({ type: 'rfi', rfi }),
      addMarkup: (markup) => dispatch({ type: 'markup', markup }),
    }),
    [state, loadMarkups, refreshVersions],
  );

  return <ReviewDataContext.Provider value={data}>{children}</ReviewDataContext.Provider>;
}
