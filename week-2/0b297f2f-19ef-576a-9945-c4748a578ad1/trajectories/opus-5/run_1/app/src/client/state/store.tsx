import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { announce as copy, teamUpdateSentence } from '../../shared/copy';
import type {
  ExhibitionResponse,
  HangEvent,
  LoanObject,
  Placement,
  Preview,
  Staff,
  StatusResponse,
  Unit,
} from '../../shared/types';
import { formatLength } from '../../shared/units';
import { api, ApiCallError, setApiStaffId } from '../api';
import { focusIds, focusTargetFor, type FocusAction } from './focus';

export type ViewParam = 'plan' | 'wall' | 'light' | 'light-eye';

export interface UndoToastState {
  actionId: string;
  kind: 'remove' | 'move';
  title: string;
  placementId: string;
  remainingMs: number;
  receivedAt: number;
}

export type ActionResult =
  | { ok: true }
  | { ok: false; error: ApiCallError };

const emptyPreview: Preview = {
  id: null,
  status: 'draft',
  date: null,
  publishAt: null,
  publishAtDisplay: null,
  remainingMs: null,
  publishedAt: null,
  publishedAtDisplay: null,
  withdrawnAt: null,
  withdrawnAtDisplay: null,
  recipients: [],
};

const emptyStatus: StatusResponse = {
  services: { database: 'up', imageStore: 'up', mailRelay: 'up' },
  checkedAt: new Date(0).toISOString(),
};

export interface AppValue {
  staffList: Staff[];
  staffId: string;
  staff: Staff | null;
  setStaffId: (id: string) => void;
  unit: Unit;
  setUnit: (unit: Unit) => void;
  exhibition: ExhibitionResponse | null;
  objects: LoanObject[];
  placements: Placement[];
  overBudgetCount: number;
  preview: Preview;
  status: StatusResponse;
  path: string;
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  viewParam: ViewParam;
  chooseView: (view: 'plan' | 'wall' | 'light') => void;
  selectedId: string | null;
  select: (placementId: string | null) => void;
  previewPanelOpen: boolean;
  openPreviewPanel: (open: boolean) => void;
  announcement: string;
  announce: (message: string) => void;
  teamUpdates: string;
  requestFocus: (elementId: string) => void;
  focusAfter: (action: FocusAction) => void;
  undoToast: UndoToastState | null;
  dismissUndoToast: () => void;
  pendingClaims: readonly string[];
  uploadingPhotos: readonly string[];
  place: (input: {
    objectId: string;
    wallId: string;
    offsetMm: number;
    centreHeightMm: number;
    heightOverride: boolean;
  }) => Promise<ActionResult>;
  nudge: (placementId: string, deltaOffsetMm: number, deltaCentreMm: number) => void;
  dragTo: (placementId: string, offsetMm: number) => void;
  endDrag: (placementId: string) => void;
  saveMove: (
    placementId: string,
    input: { offsetMm: number; centreHeightMm: number; heightOverride: boolean; wallId?: string },
  ) => Promise<ActionResult>;
  removeFromWall: (placementId: string) => Promise<ActionResult>;
  runUndo: () => Promise<void>;
  claim: (placementId: string) => Promise<void>;
  release: (placementId: string) => Promise<void>;
  markHung: (placementId: string) => Promise<void>;
  signOff: (placementId: string) => Promise<void>;
  uploadPhoto: (objectId: string, file: File) => Promise<void>;
  saveWallLux: (wallId: string, plannedLux: number) => Promise<ActionResult>;
  schedulePreview: (date: string) => Promise<ActionResult>;
  cancelPreview: () => Promise<void>;
  withdrawPreview: () => Promise<void>;
  saveObject: (
    body: Record<string, unknown>,
    objectId?: string,
  ) => Promise<{ ok: true; objectId: string } | { ok: false; error: ApiCallError }>;
  refreshObjects: () => Promise<void>;
  refreshPlacements: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('App context is missing');
  return value;
}

function readViewParam(search: string): ViewParam {
  const value = new URLSearchParams(search).get('view');
  if (value === 'wall' || value === 'light' || value === 'light-eye') return value;
  return 'plan';
}

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staffId, setStaffIdState] = useState<string>(
    () => window.localStorage.getItem('hangline.staffId') ?? '',
  );
  const [unit, setUnit] = useState<Unit>('cm');
  const [exhibition, setExhibition] = useState<ExhibitionResponse | null>(null);
  const [objects, setObjects] = useState<LoanObject[]>([]);
  const [serverPlacements, setServerPlacements] = useState<Placement[]>([]);
  const [overBudgetCount, setOverBudgetCount] = useState(0);
  const [preview, setPreview] = useState<Preview>(emptyPreview);
  const [status, setStatus] = useState<StatusResponse>(emptyStatus);
  const [path, setPath] = useState(window.location.pathname);
  const [search, setSearch] = useState(window.location.search);
  const [announcement, setAnnouncement] = useState('');
  const [teamUpdates, setTeamUpdates] = useState('');
  const [undoToast, setUndoToast] = useState<UndoToastState | null>(null);
  const [pendingClaims, setPendingClaims] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { offsetMm: number; centreHeightMm: number }>>(
    {},
  );

  const ownSeqs = useRef<Set<number>>(new Set());
  const latestSeq = useRef<number>(0);
  const saveTimers = useRef<Record<string, number>>({});
  const luxChain = useRef<Promise<unknown>>(Promise.resolve());
  const luxTickets = useRef<Record<string, number>>({});
  const placementsRef = useRef<Placement[]>([]);
  const pendingClaimsRef = useRef<Set<string>>(new Set());
  const draftsRef = useRef(drafts);
  const previousDatabase = useRef<'up' | 'down'>('up');

  const staff = useMemo(
    () => staffList.find((member) => member.id === staffId) ?? null,
    [staffList, staffId],
  );

  const placements = useMemo(
    () =>
      serverPlacements.map((placement) => {
        const draft = drafts[placement.id];
        return draft ? { ...placement, ...draft } : placement;
      }),
    [serverPlacements, drafts],
  );

  useEffect(() => {
    placementsRef.current = placements;
  }, [placements]);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const setStaffId = useCallback((id: string) => {
    window.localStorage.setItem('hangline.staffId', id);
    setApiStaffId(id);
    setStaffIdState(id);
  }, []);

  const announce = useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  const requestFocus = useCallback((elementId: string) => {
    let attempts = 0;
    const tryFocus = (): void => {
      const element = document.getElementById(elementId);
      if (element) {
        element.focus();
        if (document.activeElement === element) return;
      }
      attempts += 1;
      if (attempts < 12) window.setTimeout(tryFocus, 50);
    };
    window.setTimeout(tryFocus, 0);
  }, []);

  const focusAfter = useCallback(
    (action: FocusAction) => {
      requestFocus(focusTargetFor(action));
    },
    [requestFocus],
  );

  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    const url = new URL(to, window.location.origin);
    if (options.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setPath(url.pathname);
    setSearch(url.search);
  }, []);

  useEffect(() => {
    const onPop = (): void => {
      setPath(window.location.pathname);
      setSearch(window.location.search);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const viewParam = readViewParam(search);
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const selectedParam = params.get('work');
  const previewPanelOpen = params.get('panel') === 'preview';

  const replaceParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      navigate(`${window.location.pathname}${query === '' ? '' : `?${query}`}`, { replace: true });
    },
    [navigate],
  );

  const selectedId = useMemo(() => {
    if (selectedParam === null) return null;
    return serverPlacements.some((placement) => placement.id === selectedParam)
      ? selectedParam
      : null;
  }, [selectedParam, serverPlacements]);

  useEffect(() => {
    if (selectedParam !== null && serverPlacements.length > 0 && selectedId === null) {
      replaceParams({ work: null });
    }
  }, [selectedParam, selectedId, serverPlacements.length, replaceParams]);

  const select = useCallback(
    (placementId: string | null) => {
      replaceParams({ work: placementId });
    },
    [replaceParams],
  );

  const chooseView = useCallback(
    (view: 'plan' | 'wall' | 'light') => {
      const current = readViewParam(window.location.search);
      let next: ViewParam;
      if (view === 'light') {
        next = current === 'wall' || current === 'light-eye' ? 'light-eye' : 'light';
      } else {
        next = view;
      }
      if (next === current) return;
      replaceParams({ view: next === 'plan' ? null : next });
    },
    [replaceParams],
  );

  const openPreviewPanel = useCallback(
    (open: boolean) => {
      replaceParams({ panel: open ? 'preview' : null });
    },
    [replaceParams],
  );

  const noteOwnSeq = useCallback((seq: number | undefined) => {
    if (typeof seq === 'number') ownSeqs.current.add(seq);
  }, []);

  const refreshPlacements = useCallback(async () => {
    const result = await api.placements();
    setServerPlacements(result.placements);
    setOverBudgetCount(result.overBudgetCount);
  }, []);

  const refreshObjects = useCallback(async () => {
    const result = await api.objects();
    setObjects(result.objects);
  }, []);

  const refreshPreview = useCallback(async () => {
    const result = await api.preview();
    setPreview(result.preview);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await api.status();
      setStatus(next);
    } catch {
      /* the next poll reports the state */
    }
  }, []);

  const applyPlacement = useCallback((placement: Placement) => {
    setServerPlacements((current) => {
      const without = current.filter((item) => item.id !== placement.id);
      if (placement.status === 'removed') return without;
      return [...without, placement];
    });
  }, []);

  const clearDraft = useCallback((placementId: string) => {
    setDrafts((current) => {
      if (!(placementId in current)) return current;
      const next = { ...current };
      delete next[placementId];
      return next;
    });
  }, []);

  /* ----------------------------------------------------------------- data */

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.staff();
        setStaffList(list.staff);
        const stored = window.localStorage.getItem('hangline.staffId');
        const chosen =
          stored && list.staff.some((member) => member.id === stored)
            ? stored
            : (list.staff[0]?.id ?? '');
        setApiStaffId(chosen);
        setStaffIdState(chosen);
        window.localStorage.setItem('hangline.staffId', chosen);
      } catch {
        /* the database banner covers this */
      }
    })();
  }, []);

  useEffect(() => {
    if (staffId === '') return;
    setApiStaffId(staffId);
    void (async () => {
      try {
        const [exhibitionResponse, head] = await Promise.all([api.exhibition(), api.eventsHead()]);
        setExhibition(exhibitionResponse);
        latestSeq.current = Math.max(latestSeq.current, head.latestSeq);
        await Promise.all([refreshObjects(), refreshPlacements(), refreshPreview()]);
      } catch {
        /* the database banner covers this */
      }
    })();
  }, [staffId, refreshObjects, refreshPlacements, refreshPreview]);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 3000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (status.services.database === 'down') {
      previousDatabase.current = 'down';
      return;
    }
    if (previousDatabase.current === 'down') {
      previousDatabase.current = 'up';
      setAnnouncement(copy.databaseBack);
      focusAfter({ after: 'database-recovered' });
      void Promise.all([refreshObjects(), refreshPlacements(), refreshPreview()]).catch(
        () => undefined,
      );
    }
  }, [status, focusAfter, refreshObjects, refreshPlacements, refreshPreview]);

  const unitRef = useRef(unit);
  useEffect(() => {
    unitRef.current = unit;
  }, [unit]);

  const handleEvents = useCallback(
    (events: HangEvent[]) => {
      const sentences: string[] = [];
      let needsObjects = false;
      let needsPlacements = false;
      let needsPreview = false;
      for (const event of events) {
        if (event.kind.startsWith('placement.') || event.kind.startsWith('object.')) {
          needsPlacements = true;
          needsObjects = true;
        }
        if (event.kind === 'photo.attached') needsObjects = true;
        if (event.kind === 'wall.lux_changed') needsPlacements = true;
        if (event.kind.startsWith('preview.')) needsPreview = true;
        if (ownSeqs.current.has(event.seq)) continue;
        sentences.push(
          teamUpdateSentence(event.kind, {
            actor: event.actor?.name ?? '',
            title: event.title ?? '',
            wallName: event.wallName ?? '',
            length: formatLength(event.offsetMm ?? 0, unitRef.current),
            lux: event.plannedLux ?? 0,
            publishAtDisplay: event.publishAtDisplay ?? '',
            recipientCount: event.recipientCount ?? 0,
          }),
        );
      }
      if (sentences.length > 0) setTeamUpdates(sentences.join(' '));
      const refreshes: Promise<unknown>[] = [];
      if (needsPlacements) refreshes.push(refreshPlacements());
      if (needsObjects) refreshes.push(refreshObjects());
      if (needsPreview) refreshes.push(refreshPreview());
      if (events.some((event) => event.kind === 'wall.lux_changed')) {
        refreshes.push(api.exhibition().then(setExhibition));
      }
      void Promise.all(refreshes).catch(() => undefined);
    },
    [refreshObjects, refreshPlacements, refreshPreview],
  );

  useEffect(() => {
    if (staffId === '') return undefined;
    const poll = async (): Promise<void> => {
      try {
        const result = await api.events(latestSeq.current);
        if (result.events.length > 0) {
          latestSeq.current = result.events[result.events.length - 1]?.seq ?? result.latestSeq;
          handleEvents(result.events);
        } else {
          latestSeq.current = Math.max(latestSeq.current, result.latestSeq);
        }
      } catch {
        /* the database banner covers this */
      }
    };
    const timer = window.setInterval(() => void poll(), 2000);
    return () => window.clearInterval(timer);
  }, [staffId, handleEvents]);

  useEffect(() => {
    if (staffId === '') return undefined;
    const timer = window.setInterval(() => {
      void refreshPreview().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [staffId, refreshPreview]);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshPreview().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshPreview]);

  /* --------------------------------------------------------------- undo */

  useEffect(() => {
    if (!undoToast) return undefined;
    const timer = window.setInterval(() => {
      const left = undoToast.remainingMs - (Date.now() - undoToast.receivedAt);
      if (left <= 0) {
        const active = document.activeElement;
        const inside = active instanceof HTMLElement && active.closest('[data-region="undo"]');
        setUndoToast(null);
        if (inside) focusAfter({ after: 'toast-closed' });
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [undoToast, focusAfter]);

  const dismissUndoToast = useCallback(() => setUndoToast(null), []);

  /* ------------------------------------------------------------- actions */

  const place = useCallback<AppValue['place']>(
    async (input) => {
      try {
        const result = await api.place(input);
        noteOwnSeq(result.seq);
        applyPlacement(result.placement);
        announce(copy.placed(result.placement.objectTitle, result.placement.wallName));
        select(result.placement.id);
        focusAfter({ after: 'place-saved', placementId: result.placement.id });
        void refreshObjects();
        return { ok: true };
      } catch (error) {
        if (error instanceof ApiCallError) {
          announce(error.body.error.message);
          return { ok: false, error };
        }
        throw error;
      }
    },
    [announce, applyPlacement, focusAfter, noteOwnSeq, refreshObjects, select],
  );

  const canMove = useCallback(
    (placement: Placement): boolean => {
      if (!staff) return false;
      if (placement.status === 'proposed') return staff.role === 'curator';
      if (placement.status === 'claimed') {
        return staff.role === 'preparator' && placement.claimedBy?.id === staff.id;
      }
      return false;
    },
    [staff],
  );

  const saveMove = useCallback<AppValue['saveMove']>(
    async (placementId, input) => {
      const placement = placementsRef.current.find((item) => item.id === placementId);
      if (!placement) return { ok: true };
      try {
        const result = await api.move(placementId, {
          version: placement.version,
          offsetMm: input.offsetMm,
          centreHeightMm: input.centreHeightMm,
          heightOverride: input.heightOverride,
          ...(input.wallId !== undefined ? { wallId: input.wallId } : {}),
        });
        noteOwnSeq(result.seq);
        clearDraft(placementId);
        applyPlacement(result.placement);
        announce(
          copy.moved(
            result.placement.objectTitle,
            formatLength(result.placement.offsetMm, unitRef.current),
          ),
        );
        setUndoToast({
          actionId: result.undo.actionId,
          kind: 'move',
          title: result.placement.objectTitle,
          placementId,
          remainingMs: result.undo.remainingMs,
          receivedAt: Date.now(),
        });
        return { ok: true };
      } catch (error) {
        if (error instanceof ApiCallError) {
          clearDraft(placementId);
          if (error.status === 412 && error.body.error.placement) {
            applyPlacement(error.body.error.placement);
            announce(copy.staleVersion(error.body.error.placement.objectTitle));
          } else if (error.status === 403 || error.code === 'placement_locked') {
            announce(copy.notMovable(placement.objectTitle));
          } else {
            announce(error.body.error.message);
          }
          void refreshPlacements();
          return { ok: false, error };
        }
        throw error;
      }
    },
    [announce, applyPlacement, clearDraft, noteOwnSeq, refreshPlacements],
  );

  const nudge = useCallback<AppValue['nudge']>(
    (placementId, deltaOffsetMm, deltaCentreMm) => {
      const placement = placementsRef.current.find((item) => item.id === placementId);
      if (!placement) return;
      if (!canMove(placement)) {
        announce(copy.notMovable(placement.objectTitle));
        return;
      }
      if (deltaCentreMm !== 0 && !placement.heightOverride) return;
      const next = {
        offsetMm: placement.offsetMm + deltaOffsetMm,
        centreHeightMm: placement.centreHeightMm + deltaCentreMm,
      };
      setDrafts((current) => ({ ...current, [placementId]: next }));
      const existing = saveTimers.current[placementId];
      if (existing !== undefined) window.clearTimeout(existing);
      saveTimers.current[placementId] = window.setTimeout(() => {
        delete saveTimers.current[placementId];
        const draft = draftsRef.current[placementId];
        if (!draft) return;
        void saveMove(placementId, {
          offsetMm: draft.offsetMm,
          centreHeightMm: draft.centreHeightMm,
          heightOverride: placement.heightOverride,
        });
      }, 500);
    },
    [announce, canMove, saveMove],
  );

  const dragTo = useCallback(
    (placementId: string, offsetMm: number) => {
      const placement = placementsRef.current.find((item) => item.id === placementId);
      if (!placement) return;
      if (!canMove(placement)) return;
      setDrafts((current) => ({
        ...current,
        [placementId]: { offsetMm, centreHeightMm: placement.centreHeightMm },
      }));
    },
    [canMove],
  );

  const endDrag = useCallback(
    (placementId: string) => {
      const placement = placementsRef.current.find((item) => item.id === placementId);
      const draft = draftsRef.current[placementId];
      if (!placement || !draft) return;
      void saveMove(placementId, {
        offsetMm: draft.offsetMm,
        centreHeightMm: draft.centreHeightMm,
        heightOverride: placement.heightOverride,
      });
    },
    [saveMove],
  );

  const removeFromWall = useCallback<AppValue['removeFromWall']>(
    async (placementId) => {
      try {
        const result = await api.remove(placementId);
        noteOwnSeq(result.seq);
        applyPlacement(result.placement);
        announce(copy.removed(result.placement.objectTitle, result.placement.wallName));
        setUndoToast({
          actionId: result.undo.actionId,
          kind: 'remove',
          title: result.placement.objectTitle,
          placementId,
          remainingMs: result.undo.remainingMs,
          receivedAt: Date.now(),
        });
        focusAfter({ after: 'removed' });
        void refreshObjects();
        return { ok: true };
      } catch (error) {
        if (error instanceof ApiCallError) {
          announce(error.body.error.message);
          return { ok: false, error };
        }
        throw error;
      }
    },
    [announce, applyPlacement, focusAfter, noteOwnSeq, refreshObjects],
  );

  const runUndo = useCallback(async () => {
    const toast = undoToast;
    if (!toast) return;
    try {
      const result = await api.undo(toast.actionId);
      noteOwnSeq(result.seq);
      applyPlacement(result.placement);
      setUndoToast(null);
      announce(copy.undone(result.placement.objectTitle));
      focusAfter({ after: 'undo-accepted', placementId: result.placement.id });
      void refreshObjects();
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      setUndoToast(null);
      if (error.code === 'undo_expired') announce(copy.undoExpired);
      else announce(copy.undoChanged(toast.title));
      focusAfter({ after: 'undo-refused' });
      void refreshPlacements();
    }
  }, [announce, applyPlacement, focusAfter, noteOwnSeq, refreshObjects, refreshPlacements, undoToast]);

  const claim = useCallback(
    async (placementId: string) => {
      if (pendingClaimsRef.current.has(placementId)) return;
      pendingClaimsRef.current.add(placementId);
      setPendingClaims((current) => [...current, placementId]);
      try {
        const result = await api.claim(placementId);
        noteOwnSeq(result.seq);
        applyPlacement(result.placement);
        announce(copy.claimed(result.placement.objectTitle));
        focusAfter({ after: 'claim-won', objectId: result.placement.objectId });
      } catch (error) {
        if (!(error instanceof ApiCallError)) throw error;
        const placement = placementsRef.current.find((item) => item.id === placementId);
        if (error.code === 'already_claimed' && error.body.error.claimedBy && placement) {
          announce(copy.claimLost(error.body.error.claimedBy.name, placement.objectTitle));
          await refreshPlacements();
          focusAfter({ after: 'claim-lost', objectId: placement.objectId });
        } else {
          announce(error.body.error.message);
        }
      } finally {
        pendingClaimsRef.current.delete(placementId);
        setPendingClaims((current) => current.filter((id) => id !== placementId));
      }
    },
    [announce, applyPlacement, focusAfter, noteOwnSeq, refreshPlacements],
  );

  const release = useCallback(
    async (placementId: string) => {
      try {
        const result = await api.release(placementId);
        noteOwnSeq(result.seq);
        applyPlacement(result.placement);
        announce(copy.released(result.placement.objectTitle));
        focusAfter({ after: 'released', objectId: result.placement.objectId });
      } catch (error) {
        if (!(error instanceof ApiCallError)) throw error;
        announce(error.body.error.message);
      }
    },
    [announce, applyPlacement, focusAfter, noteOwnSeq],
  );

  const markHung = useCallback(
    async (placementId: string) => {
      const placement = placementsRef.current.find((item) => item.id === placementId);
      try {
        const result = await api.hang(placementId);
        noteOwnSeq(result.seq);
        applyPlacement(result.placement);
        announce(copy.hung(result.placement.objectTitle));
        focusAfter({ after: 'card-settled', objectId: result.placement.objectId });
      } catch (error) {
        if (!(error instanceof ApiCallError)) throw error;
        announce(error.body.error.message);
        if (placement) focusAfter({ after: 'card-settled', objectId: placement.objectId });
      }
    },
    [announce, applyPlacement, focusAfter, noteOwnSeq],
  );

  const signOff = useCallback(
    async (placementId: string) => {
      const placement = placementsRef.current.find((item) => item.id === placementId);
      try {
        const result = await api.signOff(placementId);
        noteOwnSeq(result.seq);
        applyPlacement(result.placement);
        announce(copy.signedOff(result.placement.objectTitle));
        focusAfter({ after: 'card-settled', objectId: result.placement.objectId });
      } catch (error) {
        if (!(error instanceof ApiCallError)) throw error;
        const title = placement?.objectTitle ?? '';
        if (error.code === 'condition_not_recorded') announce(copy.signOffNoPhoto(title));
        else if (error.code === 'over_budget') announce(copy.signOffOverBudget(title));
        else announce(error.body.error.message);
        if (placement) focusAfter({ after: 'card-settled', objectId: placement.objectId });
      }
    },
    [announce, applyPlacement, focusAfter, noteOwnSeq],
  );

  const uploadPhoto = useCallback(
    async (objectId: string, file: File) => {
      const object = objects.find((item) => item.id === objectId);
      const title = object?.title ?? '';
      setUploadingPhotos((current) => [...current, objectId]);
      try {
        const result = await api.uploadPhoto(objectId, file);
        noteOwnSeq(result.seq);
        await refreshObjects();
        announce(copy.photoAttached(title));
      } catch (error) {
        if (!(error instanceof ApiCallError)) throw error;
        if (error.code === 'image_store_unavailable') announce(copy.photoStoreDown(title));
        else if (error.status === 413) announce(copy.photoTooLarge);
        else if (error.status === 415) announce(copy.photoWrongType);
        else announce(error.body.error.message);
      } finally {
        setUploadingPhotos((current) => current.filter((id) => id !== objectId));
      }
    },
    [announce, noteOwnSeq, objects, refreshObjects],
  );

  const saveWallLux = useCallback<AppValue['saveWallLux']>(
    async (wallId, plannedLux) => {
      const ticket = (luxTickets.current[wallId] ?? 0) + 1;
      luxTickets.current[wallId] = ticket;
      const run = async (): Promise<ActionResult> => {
        try {
          const result = await api.setWallLux(wallId, plannedLux);
          noteOwnSeq(result.seq);
          if (luxTickets.current[wallId] !== ticket) return { ok: true };
          setExhibition((current) =>
            current
              ? {
                  ...current,
                  gallery: {
                    ...current.gallery,
                    walls: current.gallery.walls.map((wall) =>
                      wall.id === result.wall.id ? result.wall : wall,
                    ),
                  },
                }
              : current,
          );
          for (const placement of result.placements) applyPlacement(placement);
          void refreshPlacements();
          announce(copy.wallLux(result.wall.name, result.wall.plannedLux));
          return { ok: true };
        } catch (error) {
          if (!(error instanceof ApiCallError)) throw error;
          if (luxTickets.current[wallId] === ticket) announce(error.body.error.message);
          return { ok: false, error };
        }
      };
      const chained = luxChain.current.then(run, run);
      luxChain.current = chained;
      return chained;
    },
    [announce, applyPlacement, noteOwnSeq, refreshPlacements],
  );

  const schedulePreview = useCallback<AppValue['schedulePreview']>(
    async (date) => {
      try {
        const result = await api.schedulePreview(date);
        noteOwnSeq(result.seq);
        setPreview(result.preview);
        announce(copy.previewScheduled(result.preview.publishAtDisplay ?? ''));
        openPreviewPanel(true);
        focusAfter({ after: 'preview-settled' });
        return { ok: true };
      } catch (error) {
        if (!(error instanceof ApiCallError)) throw error;
        const message = error.fields['date'] ?? error.body.error.message;
        announce(message);
        if (error.fields['date']) focusAfter({ after: 'preview-date-rejected' });
        return { ok: false, error };
      }
    },
    [announce, focusAfter, noteOwnSeq, openPreviewPanel],
  );

  const cancelPreview = useCallback(async () => {
    try {
      const result = await api.cancelPreview();
      noteOwnSeq(result.seq);
      setPreview(result.preview);
      announce(copy.previewCancelled);
      openPreviewPanel(true);
      focusAfter({ after: 'preview-settled' });
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      announce(error.body.error.message);
    }
  }, [announce, focusAfter, noteOwnSeq, openPreviewPanel]);

  const withdrawPreview = useCallback(async () => {
    try {
      const result = await api.withdrawPreview();
      noteOwnSeq(result.seq);
      setPreview(result.preview);
      announce(copy.previewWithdrawn);
      openPreviewPanel(true);
      focusAfter({ after: 'preview-settled' });
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      announce(error.body.error.message);
    }
  }, [announce, focusAfter, noteOwnSeq, openPreviewPanel]);

  const saveObject = useCallback<AppValue['saveObject']>(
    async (body, objectId) => {
      try {
        if (objectId === undefined) {
          const result = await api.createObject(body);
          noteOwnSeq(result.seq);
          announce(copy.objectSaved(result.object.title));
          void refreshObjects();
          return { ok: true, objectId: result.object.id };
        }
        const result = await api.updateObject(objectId, body);
        noteOwnSeq(result.seq);
        announce(copy.objectSaved(result.object.title));
        void refreshObjects();
        void refreshPlacements();
        return { ok: true, objectId: result.object.id };
      } catch (error) {
        if (!(error instanceof ApiCallError)) throw error;
        return { ok: false, error };
      }
    },
    [announce, noteOwnSeq, refreshObjects, refreshPlacements],
  );

  const value: AppValue = {
    staffList,
    staffId,
    staff,
    setStaffId,
    unit,
    setUnit,
    exhibition,
    objects,
    placements,
    overBudgetCount,
    preview,
    status,
    path,
    search,
    navigate,
    viewParam,
    chooseView,
    selectedId,
    select,
    previewPanelOpen,
    openPreviewPanel,
    announcement,
    announce,
    teamUpdates,
    requestFocus,
    focusAfter,
    undoToast,
    dismissUndoToast,
    pendingClaims,
    uploadingPhotos,
    place,
    nudge,
    dragTo,
    endDrag,
    saveMove,
    removeFromWall,
    runUndo,
    claim,
    release,
    markHung,
    signOff,
    uploadPhoto,
    saveWallLux,
    schedulePreview,
    cancelPreview,
    withdrawPreview,
    saveObject,
    refreshObjects,
    refreshPlacements,
    refreshStatus,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export { focusIds };
