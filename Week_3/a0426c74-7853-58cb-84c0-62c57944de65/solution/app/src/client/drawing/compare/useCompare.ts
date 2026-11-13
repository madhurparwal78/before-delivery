import { useEffect, useState } from 'react';
import { buildScene, modelInput } from '../../../shared/geometry/index.ts';
import type { DiffState } from '../../../shared/geometry/index.ts';
import { historyLine, utcMinute } from '../../../shared/copy.ts';
import { SWIPE_START } from '../../../shared/rules.ts';
import type { CompareResult, DimStyle, VersionDocument, VersionSummary } from '../../../shared/types.ts';
import { getJson, onRefusal } from '../../api.ts';
import { toastRefusal } from '../../toastRefusal.ts';
import type { CompareLayers } from '../canvas/index.ts';


interface Loaded { result: CompareResult; layers: Pick<CompareLayers, 'earlier' | 'later' | 'diff'> }

/** What a loaded comparison is for: the sheet and the two versions. */
const pairKey = (sheetId: string, from: VersionSummary, to: VersionSummary): string => `${sheetId}:${from.id}:${to.id}`;

async function load(sheetId: string, from: VersionSummary, to: VersionSummary, dimStyles: Readonly<Record<string, DimStyle>>): Promise<Loaded> {
  const [result, earlier, later] = await Promise.all([
    getJson<CompareResult>(`/api/sheets/${sheetId}/compare?from=${from.number}&to=${to.number}`),
    getJson<VersionDocument>(`/api/versions/${from.id}`),
    getJson<VersionDocument>(`/api/versions/${to.id}`),
  ]);
  const diff = new Map<string, DiffState>(result.entities.map((entry) => [entry.id, entry.diff]));
  return {
    result,
    layers: {
      earlier: buildScene(modelInput(earlier.snapshot.model, dimStyles)),
      later: buildScene(modelInput(later.snapshot.model, dimStyles)),
      diff,
    },
  };
}

export interface Compare {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** the versions to choose from, oldest first */
  versions: readonly VersionSummary[];
  earlier: VersionSummary | null;
  later: VersionSummary | null;
  setEarlier: (id: string) => void;
  setLater: (id: string) => void;
  swipe: number;
  setSwipe: (percent: number) => void;
  overlay: boolean;
  setOverlay: (overlay: boolean) => void;
  result: CompareResult | null;
  /** what the pane draws; null while closed or loading */
  layers: CompareLayers | null;
  /** the history lines of the entity last clicked */
  history: readonly string[];
  showHistory: (entityId: string) => void;
}

/**
 * Delta swipe state of a sheet: the two versions (the two newest until chosen), the slider and overlay, the counts from the compare route and
 * the geometry from the two version documents.
 */
export function useCompare(sheetId: string | null, drawingId: string, versions: readonly VersionSummary[], dimStyles: Readonly<Record<string, DimStyle>>): Compare {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<{ earlier: string | null; later: string | null }>({ earlier: null, later: null });
  const [swipe, setSwipe] = useState(SWIPE_START);
  const [overlay, setOverlay] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; value: Loaded } | null>(null);
  const [history, setHistory] = useState<readonly string[]>([]);

  const find = (id: string | null): VersionSummary | undefined => versions.find((version) => version.id === id);
  const earlier = find(chosen.earlier) ?? versions[versions.length - 2] ?? null;
  const later = find(chosen.later) ?? versions[versions.length - 1] ?? null;
  const comparing = open && sheetId !== null && earlier !== null && later !== null;
  const key = comparing ? pairKey(sheetId, earlier, later) : null;

  useEffect(() => {
    if (!comparing) return undefined;
    let current = true;
    void toastRefusal(async () => {
      const value = await load(sheetId, earlier, later, dimStyles);
      if (current) setLoaded({ key: pairKey(sheetId, earlier, later), value });
    });
    return () => {
      current = false;
    };
  }, [comparing, sheetId, earlier, later, dimStyles]);

  const shown = loaded !== null && loaded.key === key ? loaded.value : null;

  function showHistory(entityId: string): void {
    void onRefusal(
      async () => {
        const answer = await getJson<{ history: { username: string; command: string; at: string }[] }>(`/api/drawings/${drawingId}/entities/${encodeURIComponent(entityId)}/history`);
        setHistory(answer.history.map((entry) => historyLine(entry.username, entry.command, utcMinute(Date.parse(entry.at)))));
      },
      () => setHistory([]),
    );
  }

  return {
    open,
    setOpen,
    versions,
    earlier,
    later,
    setEarlier: (id) => setChosen((previous) => ({ ...previous, earlier: id })),
    setLater: (id) => setChosen((previous) => ({ ...previous, later: id })),
    swipe,
    setSwipe,
    overlay,
    setOverlay,
    result: shown?.result ?? null,
    layers: shown ? { ...shown.layers, swipe, overlay } : null,
    history,
    showHistory,
  };
}
