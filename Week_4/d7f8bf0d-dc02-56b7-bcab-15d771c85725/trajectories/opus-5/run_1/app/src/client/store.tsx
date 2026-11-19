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
import type {
  CrewPacket,
  Finding,
  HistoryRow,
  LayoutDetail,
  LayoutVersionSummary,
  PieceInput,
  Role,
  SessionSnapshot,
  SessionStatus,
  StandardsProfileWithRevision,
  TimetableEntry,
} from '../shared/protocol.js';
import {
  api,
  ApiFailure,
  layoutPath,
  newKey,
  sessionPath,
  setUnauthorisedHandler,
  workspacePath,
} from './lib/api.js';
import { copy } from './lib/copy.js';
import { openStream } from './lib/stream.js';
import { readView, writeView, type ViewState } from './lib/viewState.js';

export interface Me {
  user: { id: string; email: string; display_name: string; walkthrough_done: boolean };
  memberships: { workspace_id: string; workspace_name: string; role: Role }[];
}

export interface LayoutListRow {
  id: string;
  name: string;
  revision: number;
  counts: { modules: number; pieces: number; blocks: number; trash: number };
}

export interface SessionListRow {
  id: string;
  name: string;
  status: SessionStatus;
  tick: number;
  layout_version_number: number;
}

export interface MemberRow {
  user_id: string;
  display_name: string;
  email: string;
  role: Role;
  revision: number;
}

export interface TrashRow {
  id: string;
  name: string;
  trashed_by: string;
  trashed_at: string;
}

export interface PacketPreview {
  session_version: number;
  content_hash: string;
  content: { train_orders: string[]; timetable: { time: string; train: string; station: string }[] };
}

export interface RoutePreview {
  route_block_ids: string[];
  limit_block_id: string;
  clear: boolean;
  conflict_block_id: string | null;
  other_train_number: string | null;
}

export interface BlockResult {
  id: string;
  number: number;
  name: string;
  kind: string;
}

export interface ServiceStatus {
  valkey: 'up' | 'down';
  gotenberg: 'up' | 'down';
  instance: string;
}

export interface AppStore {
  phase: 'booting' | 'signed-out' | 'ready';
  me: Me | null;
  view: ViewState;
  role: Role | null;
  layout: LayoutDetail | null;
  session: SessionSnapshot | null;
  layouts: LayoutListRow[];
  sessions: SessionListRow[];
  versions: LayoutVersionSummary[];
  packets: CrewPacket[];
  packetPreview: PacketPreview | null;
  members: MemberRow[];
  standards: StandardsProfileWithRevision | null;
  trash: TrashRow[];
  history: HistoryRow[];
  findings: Finding[];
  status: string;
  error: string | null;
  outage: string | null;
  service: ServiceStatus;
  signInAgain: boolean;
  signInAgainFailed: boolean;
  snapshotProgress: number;
  lastTile: string | null;
  routePreview: RoutePreview | null;
  blockResults: BlockResult[];
  actions: Actions;
}

export interface Actions {
  signIn(email: string, password: string): Promise<boolean>;
  signInAgainWith(password: string): Promise<void>;
  signOut(): Promise<void>;
  finishWalkthrough(): Promise<void>;
  dismissError(): void;
  announce(text: string): void;
  createWorkspace(name: string, template: 'reference' | 'empty'): Promise<void>;
  openWorkspace(workspaceId: string): Promise<void>;
  openLayout(layoutId: string): Promise<void>;
  createLayout(name: string): Promise<void>;
  addModule(name: string, endplate: 'single' | 'double'): Promise<void>;
  appendPiece(tile: string, piece: PieceInput): Promise<void>;
  undoLastPiece(): Promise<void>;
  applyPiece(
    pieceId: string,
    changes: { rise_mm?: number; block_id?: string | null; note?: string },
  ): Promise<void>;
  removePiece(pieceId: string): Promise<void>;
  trashModule(): Promise<void>;
  undoTrash(moduleId: string): Promise<void>;
  purgeTrash(moduleId: string): Promise<void>;
  checkLayout(): Promise<void>;
  saveVersion(label: string): Promise<void>;
  validateVersion(versionId: string, number: number, revision: number): Promise<void>;
  publishVersion(versionId: string, number: number, revision: number): Promise<void>;
  restoreVersion(versionId: string, number: number): Promise<void>;
  renameBlock(blockId: string, name: string): Promise<void>;
  renameStation(stationId: string, name: string): Promise<void>;
  saveTimetable(entries: TimetableEntry[]): Promise<void>;
  saveStandards(profile: StandardsProfileWithRevision): Promise<void>;
  addMember(
    displayName: string,
    email: string,
    password: string,
    role: 'manager' | 'member' | 'operator',
  ): Promise<void>;
  createSession(name: string, versionId: string, ratio: number): Promise<void>;
  openSession(sessionId: string): Promise<void>;
  sessionCommand(command: 'start' | 'hold' | 'resume' | 'end'): Promise<void>;
  addExtraTrain(body: Record<string, unknown>): Promise<void>;
  previewRoute(trainId: string, destinationId: string, viaId: string | null): void;
  clearPreview(): void;
  searchBlocks(query: string): void;
  highball(
    trainId: string,
    destinationId: string,
    viaId: string | null,
    timeLimitFastSeconds: number,
  ): Promise<void>;
  cancelAuthority(authorityId: string): Promise<void>;
  backToLoop(trainId: string): Promise<void>;
  recall(trainId: string): Promise<void>;
  saveNote(conflictId: string, note: string): Promise<void>;
  withdraw(conflictId: string): Promise<void>;
  setBlockService(blockId: string, outOfService: boolean): Promise<void>;
  issuePacket(): Promise<void>;
  refreshPackets(): Promise<void>;
  refreshSheet(sheet: string): Promise<void>;
}

const StoreContext = createContext<AppStore | null>(null);

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('Store is not mounted');
  return store;
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiFailure) return error.message;
  return 'Something went wrong.';
}

export function StoreProvider({
  children,
  onSceneReset,
}: {
  children: ReactNode;
  onSceneReset?: () => void;
}): JSX.Element {
  const [phase, setPhase] = useState<AppStore['phase']>('booting');
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<ViewState>(() => readView());
  const [layout, setLayout] = useState<LayoutDetail | null>(null);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [layouts, setLayouts] = useState<LayoutListRow[]>([]);
  const [sessions, setSessions] = useState<SessionListRow[]>([]);
  const [versions, setVersions] = useState<LayoutVersionSummary[]>([]);
  const [packets, setPackets] = useState<CrewPacket[]>([]);
  const [packetPreview, setPacketPreview] = useState<PacketPreview | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [standards, setStandards] = useState<StandardsProfileWithRevision | null>(null);
  const [trash, setTrash] = useState<TrashRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outage, setOutage] = useState<string | null>(null);
  const [service, setService] = useState<ServiceStatus>({
    valkey: 'up',
    gotenberg: 'up',
    instance: '',
  });
  const [signInAgain, setSignInAgain] = useState(false);
  const [signInAgainFailed, setSignInAgainFailed] = useState(false);
  const [snapshotProgress, setSnapshotProgress] = useState(0);
  const [lastTile, setLastTile] = useState<string | null>(null);
  const [routePreview, setRoutePreview] = useState<RoutePreview | null>(null);
  const [blockResults, setBlockResults] = useState<BlockResult[]>([]);

  const pendingRetries = useRef<(() => Promise<unknown>)[]>([]);
  const appliedLayoutSeq = useRef(0);
  const appliedSessionSeq = useRef(0);
  const inFlightAppend = useRef<Promise<void> | null>(null);
  const previewToken = useRef(0);
  const searchToken = useRef(0);
  const previewTimer = useRef<number | null>(null);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    const update = (): void => setView(readView());
    window.addEventListener('gandyboard:view', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('gandyboard:view', update);
      window.removeEventListener('popstate', update);
    };
  }, []);

  const signedIn = useRef(false);

  useEffect(() => {
    setUnauthorisedHandler((retry) => {
      if (!signedIn.current) return false;
      pendingRetries.current.push(retry);
      setSignInAgain(true);
      return true;
    });
  }, []);

  const announce = useCallback((text: string) => setStatus(text), []);

  const fail = useCallback((problem: unknown) => {
    const message = failureMessage(problem);
    setStatus(message);
    setError(message);
    if (problem instanceof ApiFailure && Array.isArray(problem.body.findings)) {
      setFindings(problem.body.findings);
    }
  }, []);

  const loadLayout = useCallback(
    async (workspaceId: string, layoutId: string): Promise<LayoutDetail | null> => {
      const detail = await api.get<LayoutDetail>(layoutPath(workspaceId, layoutId));
      appliedLayoutSeq.current = detail.revision;
      setLayout(detail);
      return detail;
    },
    [],
  );

  const loadSession = useCallback(
    async (workspaceId: string, sessionId: string): Promise<void> => {
      const snapshot = await api.get<SessionSnapshot>(sessionPath(workspaceId, sessionId));
      appliedSessionSeq.current = snapshot.revision;
      setSession(snapshot);
    },
    [],
  );

  const refreshStatus = useCallback(async () => {
    try {
      const next = await api.get<ServiceStatus>('/api/status');
      setService(next);
      setOutage((current) => {
        if (next.valkey === 'down') return copy.valkeyDown;
        if (current === copy.valkeyDown) return copy.valkeyBack;
        return current === copy.valkeyBack ? copy.valkeyBack : null;
      });
    } catch {
      /* the next probe tries again */
    }
  }, []);

  const refreshLists = useCallback(async (workspaceId: string) => {
    const [layoutList, sessionList] = await Promise.all([
      api.get<{ layouts: LayoutListRow[] }>(`${workspacePath(workspaceId)}/layouts`),
      api.get<{ sessions: SessionListRow[] }>(`${workspacePath(workspaceId)}/sessions`),
    ]);
    setLayouts(layoutList.layouts);
    setSessions(sessionList.sessions);
    return layoutList.layouts;
  }, []);

  const bootWorkspace = useCallback(
    async (workspaceId: string, layoutId: string | null, sessionId: string | null) => {
      setSnapshotProgress(20);
      const available = await refreshLists(workspaceId);
      setSnapshotProgress(50);
      const chosen = layoutId && available.some((row) => row.id === layoutId)
        ? layoutId
        : available[0]?.id ?? null;
      if (chosen) await loadLayout(workspaceId, chosen);
      setSnapshotProgress(75);
      const [versionList, standardsProfile] = await Promise.all([
        chosen
          ? api.get<{ versions: LayoutVersionSummary[] }>(
              `${layoutPath(workspaceId, chosen)}/versions`,
            )
          : Promise.resolve({ versions: [] }),
        api.get<StandardsProfileWithRevision>(`${workspacePath(workspaceId)}/standards`),
      ]);
      setVersions(versionList.versions);
      setStandards(standardsProfile);
      if (sessionId) {
        try {
          await loadSession(workspaceId, sessionId);
        } catch {
          setSession(null);
        }
      } else {
        setSession(null);
      }
      setSnapshotProgress(100);
      writeView({ workspace: workspaceId, layout: chosen, session: sessionId });
    },
    [loadLayout, loadSession, refreshLists],
  );

  const boot = useCallback(async () => {
    try {
      const identity = await api.get<Me>('/api/me');
      signedIn.current = true;
      setMe(identity);
      const current = readView();
      const workspaceId =
        current.workspace && identity.memberships.some((m) => m.workspace_id === current.workspace)
          ? current.workspace
          : identity.memberships[0]?.workspace_id ?? null;
      if (workspaceId) await bootWorkspace(workspaceId, current.layout, current.session);
      await refreshStatus();
      setPhase('ready');
    } catch (problem) {
      signedIn.current = false;
      setPhase('signed-out');
    }
  }, [bootWorkspace, refreshStatus]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = window.setInterval(() => void refreshStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [phase, refreshStatus]);

  /** Layout events: applied strictly by sequence, with a snapshot read on a gap. */
  useEffect(() => {
    if (phase !== 'ready' || !view.workspace || !view.layout) return;
    const workspaceId = view.workspace;
    const layoutId = view.layout;
    return openStream(`${layoutPath(workspaceId, layoutId)}/events`, {
      onEvent: (seq) => {
        if (seq <= appliedLayoutSeq.current) return;
        void loadLayout(workspaceId, layoutId);
      },
      onResync: () => void loadLayout(workspaceId, layoutId),
      onDown: () => undefined,
    });
  }, [phase, view.workspace, view.layout, loadLayout]);

  /** Session events carry the whole snapshot, so each one is applied in place. */
  useEffect(() => {
    if (phase !== 'ready' || !view.workspace || !view.session) return;
    const workspaceId = view.workspace;
    const sessionId = view.session;
    return openStream(`${sessionPath(workspaceId, sessionId)}/events`, {
      onEvent: (seq, type, data) => {
        if (seq <= appliedSessionSeq.current) return;
        if (seq > appliedSessionSeq.current + 1) {
          void loadSession(workspaceId, sessionId);
          return;
        }
        const payload = data as {
          session?: SessionSnapshot;
          detail?: {
            deadlocks_raised?: { train_numbers: string[] }[];
            authorities_revoked?: { train_number: string; ended_reason: string }[];
          };
        };
        if (!payload.session) return;
        appliedSessionSeq.current = seq;
        setSession(payload.session);
        if (type === 'packet.changed') void refreshPacketsRef.current?.();
        const raised = payload.detail?.deadlocks_raised ?? [];
        if (raised.length > 0) setStatus(copy.deadlock(raised[0].train_numbers));
        for (const revoked of payload.detail?.authorities_revoked ?? []) {
          if (revoked.ended_reason === 'expired') {
            setStatus(copy.authorityExpired(revoked.train_number));
          }
        }
      },
      onResync: () => void loadSession(workspaceId, sessionId),
      onDown: () => undefined,
    });
  }, [phase, view.workspace, view.session, loadSession]);

  const refreshPacketsRef = useRef<(() => Promise<void>) | null>(null);

  const workspaceId = view.workspace ?? '';
  const layoutId = view.layout ?? '';
  const sessionId = view.session ?? '';

  const role = useMemo(
    () => me?.memberships.find((entry) => entry.workspace_id === workspaceId)?.role ?? null,
    [me, workspaceId],
  );

  const refreshPackets = useCallback(async () => {
    if (!workspaceId || !sessionId) return;
    const [list, preview] = await Promise.all([
      api.get<{ packets: CrewPacket[] }>(`${sessionPath(workspaceId, sessionId)}/packets`),
      api.get<PacketPreview>(`${sessionPath(workspaceId, sessionId)}/packets/preview`),
    ]);
    setPackets(list.packets);
    setPacketPreview(preview);
  }, [workspaceId, sessionId]);

  refreshPacketsRef.current = refreshPackets;

  const selectedModuleId = useMemo(() => {
    if (!layout) return null;
    const current = view;
    for (const module of layout.content.modules) {
      if (current.piece && module.pieces.some((piece) => piece.id === current.piece)) {
        return module.id;
      }
      if (current.end && module.open_ends.some((end) => end.id === current.end)) return module.id;
    }
    return layout.content.modules[0]?.id ?? null;
  }, [layout, view]);

  const actions = useMemo<Actions>(() => {
    const L = (): string => layoutPath(workspaceId, layoutId);
    const S = (): string => sessionPath(workspaceId, sessionId);

    const afterLayoutChange = async (): Promise<void> => {
      await loadLayout(workspaceId, layoutId);
      await refreshLists(workspaceId);
      if (service.valkey === 'down') setOutage(copy.savedWhileValkeyDown);
    };

    const guard = async (
      pending: string,
      work: () => Promise<string | null>,
    ): Promise<void> => {
      setError(null);
      setStatus(pending);
      try {
        const done = await work();
        if (done !== null) setStatus(done);
      } catch (problem) {
        fail(problem);
      }
    };

    return {
      async signIn(email, password) {
        setError(null);
        setStatus(copy.signInPending);
        try {
          await api.post('/api/auth/sign-in', { email, password });
          setStatus(copy.signInDone);
          setPhase('booting');
          await boot();
          return true;
        } catch (problem) {
          fail(problem);
          return false;
        }
      },
      async signInAgainWith(password) {
        if (!me) return;
        setSignInAgainFailed(false);
        setStatus(copy.signInPending);
        try {
          await api.post('/api/auth/sign-in', { email: me.user.email, password });
          setStatus(copy.signInDone);
          setSignInAgain(false);
          const retries = pendingRetries.current;
          pendingRetries.current = [];
          for (const retry of retries) await retry().catch(() => undefined);
        } catch {
          setSignInAgainFailed(true);
          setStatus(copy.signInFailed);
        }
      },
      async signOut() {
        await api.post('/api/auth/sign-out');
        signedIn.current = false;
        setMe(null);
        setSession(null);
        setLayout(null);
        setPhase('signed-out');
      },
      async finishWalkthrough() {
        await api.post('/api/me/walkthrough', { done: true });
        setMe((current) =>
          current
            ? { ...current, user: { ...current.user, walkthrough_done: true } }
            : current,
        );
      },
      dismissError() {
        setError(null);
      },
      announce,
      async createWorkspace(name, template) {
        await guard('Creating workspace.', async () => {
          const created = await api.post<{ workspace: { id: string }; layout: { id: string } }>(
            '/api/workspaces',
            { name, template },
            newKey(),
          );
          const identity = await api.get<Me>('/api/me');
          setMe(identity);
          await bootWorkspace(created.workspace.id, created.layout.id, null);
          onSceneReset?.();
          return 'Workspace created.';
        });
      },
      async openWorkspace(nextWorkspaceId) {
        await bootWorkspace(nextWorkspaceId, null, null);
        onSceneReset?.();
      },
      async openLayout(nextLayoutId) {
        writeView({ layout: nextLayoutId, piece: null, end: null });
        await loadLayout(workspaceId, nextLayoutId);
        const list = await api.get<{ versions: LayoutVersionSummary[] }>(
          `${layoutPath(workspaceId, nextLayoutId)}/versions`,
        );
        setVersions(list.versions);
        onSceneReset?.();
      },
      async createLayout(name) {
        await guard('Creating layout.', async () => {
          const created = await api.post<{ layout: { id: string } }>(
            `${workspacePath(workspaceId)}/layouts`,
            { name },
            newKey(),
          );
          await refreshLists(workspaceId);
          writeView({ layout: created.layout.id });
          await loadLayout(workspaceId, created.layout.id);
          return 'Layout created.';
        });
      },
      async addModule(name, endplate) {
        if (!layout) return;
        const width = endplate === 'double' ? standards?.endplate_double_mm ?? 660 : standards?.endplate_single_mm ?? 610;
        const offsets =
          endplate === 'double'
            ? [-(standards?.double_track_offset_mm ?? 25), standards?.double_track_offset_mm ?? 25]
            : [0];
        await guard('Adding module.', async () => {
          const created = await api.post<{ module: { id: string; open_ends: { id: string }[] } }>(
            `${L()}/modules`,
            {
              revision: layout.revision,
              name,
              endplates: [
                { end: 'A', width_mm: width, track_offsets_mm: offsets },
                { end: 'B', width_mm: width, track_offsets_mm: offsets },
              ],
            },
            newKey(),
          );
          await afterLayoutChange();
          writeView({ end: created.module.open_ends[0]?.id ?? null, piece: null });
          return 'Module added.';
        });
      },
      async appendPiece(tile, piece) {
        if (!layout || inFlightAppend.current) return;
        const moduleId = selectedModuleId;
        if (!moduleId) return;
        const module = layout.content.modules.find((entry) => entry.id === moduleId);
        if (!module) return;
        const endId =
          view.end && module.open_ends.some((end) => end.id === view.end)
            ? view.end
            : module.open_ends[module.open_ends.length - 1]?.id;
        if (!endId) return;
        const key = newKey();
        const work = guard(copy.addPiecePending, async () => {
          await api.post(
            `${L()}/modules/${moduleId}/pieces`,
            {
              revision: layout.module_revisions[moduleId] ?? 0,
              open_end_id: endId,
              piece: piece as unknown as Record<string, unknown>,
            },
            key,
          );
          const detail = await loadLayout(workspaceId, layoutId);
          const next = detail?.content.modules.find((entry) => entry.id === moduleId);
          writeView({ end: next?.open_ends[next.open_ends.length - 1]?.id ?? null });
          await refreshLists(workspaceId);
          setLastTile(tile);
          if (service.valkey === 'down') setOutage(copy.savedWhileValkeyDown);
          return copy.addPieceDone;
        });
        inFlightAppend.current = work.finally(() => {
          inFlightAppend.current = null;
        });
        await inFlightAppend.current;
      },
      async undoLastPiece() {
        if (!layout || !me) return;
        const moduleId = selectedModuleId;
        if (!moduleId) return;
        const module = layout.content.modules.find((entry) => entry.id === moduleId);
        const mine = module?.pieces.filter((piece) => piece.added_by === me.user.display_name) ?? [];
        const newest = mine[mine.length - 1];
        if (!newest) return;
        await this.removePiece(newest.id);
      },
      async applyPiece(pieceId, changes) {
        if (!layout) return;
        const moduleId =
          layout.content.modules.find((module) =>
            module.pieces.some((piece) => piece.id === pieceId),
          )?.id ?? null;
        if (!moduleId) return;
        await guard(copy.applyPiecePending, async () => {
          await api.patch(
            `${L()}/modules/${moduleId}/pieces/${pieceId}`,
            { revision: layout.module_revisions[moduleId] ?? 0, ...changes },
            newKey(),
          );
          await afterLayoutChange();
          return copy.applyPieceDone;
        });
      },
      async removePiece(pieceId) {
        if (!layout) return;
        const moduleId =
          layout.content.modules.find((module) =>
            module.pieces.some((piece) => piece.id === pieceId),
          )?.id ?? null;
        if (!moduleId) return;
        await guard(copy.removePiecePending, async () => {
          await api.post(
            `${L()}/modules/${moduleId}/pieces/${pieceId}/remove`,
            { revision: layout.module_revisions[moduleId] ?? 0 },
            newKey(),
          );
          await afterLayoutChange();
          writeView({ piece: null });
          return copy.removePieceDone;
        });
      },
      async trashModule() {
        if (!layout || !selectedModuleId) return;
        await guard(copy.trashPending, async () => {
          await api.post(
            `${L()}/modules/${selectedModuleId}/trash`,
            { revision: layout.revision },
            newKey(),
          );
          await afterLayoutChange();
          writeView({ piece: null, end: null });
          return copy.trashDone;
        });
      },
      async undoTrash(moduleId) {
        if (!layout) return;
        await guard(copy.undoPending, async () => {
          await api.post(
            `${L()}/trash/${moduleId}/undo`,
            { revision: layout.revision },
            newKey(),
          );
          await afterLayoutChange();
          const list = await api.get<{ modules: TrashRow[] }>(`${L()}/trash`);
          setTrash(list.modules);
          return copy.undoDone;
        });
      },
      async purgeTrash(moduleId) {
        if (!layout) return;
        await guard(copy.purgePending, async () => {
          await api.post(
            `${L()}/trash/${moduleId}/purge`,
            { revision: layout.revision },
            newKey(),
          );
          await afterLayoutChange();
          const list = await api.get<{ modules: TrashRow[] }>(`${L()}/trash`);
          setTrash(list.modules);
          return copy.purgeDone;
        });
      },
      async checkLayout() {
        await guard(copy.checkPending, async () => {
          const report = await api.post<{ passed: boolean; findings: Finding[] }>(`${L()}/check`);
          setFindings(report.findings);
          return report.passed ? copy.checkPassed : copy.checkFailed(report.findings.length);
        });
      },
      async saveVersion(label) {
        if (!layout) return;
        await guard(copy.saveVersionPending, async () => {
          const saved = await api.post<{ version: LayoutVersionSummary }>(
            `${L()}/versions`,
            { revision: layout.revision, label },
            newKey(),
          );
          const list = await api.get<{ versions: LayoutVersionSummary[] }>(`${L()}/versions`);
          setVersions(list.versions);
          await loadLayout(workspaceId, layoutId);
          return copy.saveVersionDone(saved.version.number);
        });
      },
      async validateVersion(versionId, number, revision) {
        await guard(copy.validatePending(number), async () => {
          try {
            await api.post(`${L()}/versions/${versionId}/validate`, { revision }, newKey());
          } catch (problem) {
            if (problem instanceof ApiFailure && problem.body.findings) {
              setFindings(problem.body.findings);
              const list = await api.get<{ versions: LayoutVersionSummary[] }>(`${L()}/versions`);
              setVersions(list.versions);
              setError(problem.message);
              return copy.validateFailed(number, problem.body.findings.length);
            }
            throw problem;
          }
          const list = await api.get<{ versions: LayoutVersionSummary[] }>(`${L()}/versions`);
          setVersions(list.versions);
          setFindings([]);
          return copy.validateDone(number);
        });
      },
      async publishVersion(versionId, number, revision) {
        await guard(copy.publishPending(number), async () => {
          await api.post(`${L()}/versions/${versionId}/publish`, { revision }, newKey());
          const list = await api.get<{ versions: LayoutVersionSummary[] }>(`${L()}/versions`);
          setVersions(list.versions);
          return copy.publishDone(number);
        });
      },
      async restoreVersion(versionId, number) {
        if (!layout) return;
        await guard(copy.restorePending(number), async () => {
          const restored = await api.post<{ version: LayoutVersionSummary }>(
            `${L()}/versions/${versionId}/restore`,
            { revision: layout.revision },
            newKey(),
          );
          const list = await api.get<{ versions: LayoutVersionSummary[] }>(`${L()}/versions`);
          setVersions(list.versions);
          await afterLayoutChange();
          onSceneReset?.();
          return copy.restoreDone(restored.version.number);
        });
      },
      async renameBlock(blockId, name) {
        if (!layout) return;
        await guard(copy.renamePending, async () => {
          await api.patch(
            `${L()}/blocks/${blockId}`,
            { revision: layout.revision, name },
            newKey(),
          );
          await afterLayoutChange();
          if (sessionId) await loadSession(workspaceId, sessionId);
          await refreshPackets().catch(() => undefined);
          return copy.renameDone(name);
        });
      },
      async renameStation(stationId, name) {
        if (!layout) return;
        await guard(copy.renamePending, async () => {
          await api.patch(
            `${L()}/stations/${stationId}`,
            { revision: layout.revision, name },
            newKey(),
          );
          await afterLayoutChange();
          if (sessionId) await loadSession(workspaceId, sessionId);
          await refreshPackets().catch(() => undefined);
          return copy.renameDone(name);
        });
      },
      async saveTimetable(entries) {
        if (!layout) return;
        await guard(copy.timetablePending, async () => {
          await api.put(`${L()}/timetable`, { revision: layout.revision, entries }, newKey());
          await afterLayoutChange();
          return copy.timetableDone;
        });
      },
      async saveStandards(profile) {
        await guard(copy.standardsPending, async () => {
          const saved = await api.put<StandardsProfileWithRevision>(
            `${workspacePath(workspaceId)}/standards`,
            { ...profile },
            newKey(),
          );
          setStandards(saved);
          return copy.standardsDone;
        });
      },
      async addMember(displayName, email, password, memberRole) {
        await guard(copy.memberPending, async () => {
          await api.post(
            `${workspacePath(workspaceId)}/members`,
            { display_name: displayName, email, password, role: memberRole },
            newKey(),
          );
          const list = await api.get<{ members: MemberRow[] }>(
            `${workspacePath(workspaceId)}/members`,
          );
          setMembers(list.members);
          return copy.memberDone;
        });
      },
      async createSession(name, versionId, ratio) {
        await guard(copy.createSessionPending, async () => {
          const created = await api.post<SessionSnapshot>(
            `${workspacePath(workspaceId)}/sessions`,
            { name, layout_version_id: versionId, ratio },
            newKey(),
          );
          await refreshLists(workspaceId);
          appliedSessionSeq.current = created.revision;
          setSession(created);
          writeView({ session: created.id, mode: 'operate' });
          return copy.createSessionDone;
        });
      },
      async openSession(nextSessionId) {
        writeView({ session: nextSessionId, mode: 'operate', sheet: null });
        await loadSession(workspaceId, nextSessionId);
        await refreshPackets().catch(() => undefined);
      },
      async sessionCommand(command) {
        if (!session) return;
        const pending = {
          start: copy.startPending,
          hold: copy.holdPending,
          resume: copy.resumePending,
          end: copy.endPending,
        }[command];
        await guard(pending, async () => {
          const next = await api.post<SessionSnapshot>(
            `${S()}/${command}`,
            { revision: session.control_revision },
            newKey(),
          );
          appliedSessionSeq.current = next.revision;
          setSession(next);
          await refreshLists(workspaceId);
          return {
            start: copy.startDone,
            hold: copy.holdDone(next.tick),
            resume: copy.resumeDone(next.tick),
            end: copy.endDone,
          }[command];
        });
      },
      async addExtraTrain(body) {
        if (!session) return;
        await guard(copy.addTrainPending, async () => {
          const next = await api.post<SessionSnapshot>(
            `${S()}/trains`,
            { revision: session.session_version, ...body },
            newKey(),
          );
          appliedSessionSeq.current = next.revision;
          setSession(next);
          await refreshPackets().catch(() => undefined);
          return copy.addTrainDone(String(body['number']), next.session_version);
        });
      },
      previewRoute(trainId, destinationId, viaId) {
        if (!session || !destinationId) {
          setRoutePreview(null);
          return;
        }
        previewToken.current += 1;
        const token = previewToken.current;
        if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
        previewTimer.current = window.setTimeout(() => {
          void api
            .post<RoutePreview>(`${S()}/trains/${trainId}/route-preview`, {
              destination_block_id: destinationId,
              via_block_id: viaId ?? '',
            })
            .then((answer) => {
              if (token !== previewToken.current) return;
              setRoutePreview(answer);
            })
            .catch((problem: unknown) => {
              if (token !== previewToken.current) return;
              setRoutePreview(null);
              setStatus(failureMessage(problem));
            });
        }, 250);
      },
      clearPreview() {
        previewToken.current += 1;
        setRoutePreview(null);
      },
      searchBlocks(query) {
        searchToken.current += 1;
        const token = searchToken.current;
        if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
        searchTimer.current = window.setTimeout(() => {
          const base = sessionId ? `${S()}/blocks` : `${L()}/blocks`;
          void api
            .get<{ blocks: BlockResult[] }>(`${base}?q=${encodeURIComponent(query)}`)
            .then((answer) => {
              if (token !== searchToken.current) return;
              setBlockResults(answer.blocks);
            })
            .catch(() => undefined);
        }, 250);
      },
      async highball(trainId, destinationId, viaId, timeLimitFastSeconds) {
        if (!session) return;
        const train = session.trains.find((entry) => entry.id === trainId);
        if (!train) return;
        setError(null);
        setStatus(copy.highballPending(train.number));
        try {
          const granted = await api.post<{ authority: { block_ids: string[] } }>(
            `${S()}/trains/${trainId}/authorities`,
            {
              revision: train.revision,
              destination_block_id: destinationId,
              via_block_id: viaId ?? '',
              time_limit_fast_seconds: timeLimitFastSeconds,
            },
            newKey(),
          );
          await loadSession(workspaceId, sessionId);
          const destination = session.blocks.find((block) => block.id === destinationId);
          setStatus(
            copy.highballDone(
              train.number,
              destination?.name ?? '',
              granted.authority.block_ids.length,
            ),
          );
        } catch (problem) {
          if (problem instanceof ApiFailure && problem.code === 'route_conflict') {
            const conflict = problem.body.conflict;
            await loadSession(workspaceId, sessionId);
            writeView({ sheet: 'conflict', train: trainId });
            const blockName =
              session.blocks.find((block) => block.id === conflict?.block_id)?.name ?? '';
            const other = session.trains.find((entry) => entry.id === conflict?.other_train_id);
            setStatus(
              other
                ? `Train ${train.number} refused at ${blockName}: held by Train ${other.number}.`
                : `Train ${train.number} refused at ${blockName}: out of service.`,
            );
            return;
          }
          fail(problem);
        }
      },
      async cancelAuthority(authorityId) {
        if (!session) return;
        const authority = session.authorities.find((entry) => entry.id === authorityId);
        if (!authority) return;
        await guard(copy.cancelPending, async () => {
          await api.post(
            `${S()}/authorities/${authorityId}/cancel`,
            { revision: authority.revision },
            newKey(),
          );
          await loadSession(workspaceId, sessionId);
          return copy.cancelDone;
        });
      },
      async backToLoop(trainId) {
        if (!session) return;
        const train = session.trains.find((entry) => entry.id === trainId);
        if (!train) return;
        await guard(copy.backToLoopPending(train.number), async () => {
          const next = await api.post<SessionSnapshot>(
            `${S()}/trains/${trainId}/back-to-loop`,
            { revision: train.revision },
            newKey(),
          );
          appliedSessionSeq.current = next.revision;
          setSession(next);
          const moved = next.trains.find((entry) => entry.id === trainId);
          const block = next.blocks.find((entry) => entry.id === moved?.head_block_id);
          return copy.backToLoopDone(train.number, block?.name ?? '');
        });
      },
      async recall(trainId) {
        if (!session) return;
        const train = session.trains.find((entry) => entry.id === trainId);
        if (!train) return;
        await guard(copy.recallPending(train.number), async () => {
          const next = await api.post<SessionSnapshot>(
            `${S()}/trains/${trainId}/recall`,
            { revision: train.revision },
            newKey(),
          );
          appliedSessionSeq.current = next.revision;
          setSession(next);
          const moved = next.trains.find((entry) => entry.id === trainId);
          const block = next.blocks.find((entry) => entry.id === moved?.head_block_id);
          return copy.recallDone(train.number, block?.name ?? '');
        });
      },
      async saveNote(conflictId, note) {
        if (!session) return;
        const conflict = session.conflicts.find((entry) => entry.id === conflictId);
        if (!conflict) return;
        await guard(copy.notePending, async () => {
          await api.patch(
            `${S()}/conflicts/${conflictId}`,
            { revision: conflict.revision, note },
            newKey(),
          );
          await loadSession(workspaceId, sessionId);
          return copy.noteDone;
        });
      },
      async withdraw(conflictId) {
        if (!session) return;
        const conflict = session.conflicts.find((entry) => entry.id === conflictId);
        if (!conflict) return;
        await guard(copy.withdrawPending, async () => {
          const next = await api.post<SessionSnapshot>(
            `${S()}/conflicts/${conflictId}/withdraw`,
            { revision: conflict.revision },
            newKey(),
          );
          appliedSessionSeq.current = next.revision;
          setSession(next);
          return copy.withdrawDone;
        });
      },
      async setBlockService(blockId, outOfService) {
        if (!session) return;
        const block = session.blocks.find((entry) => entry.id === blockId);
        await guard(copy.servicePending, async () => {
          const next = await api.post<SessionSnapshot>(
            `${S()}/blocks/${blockId}/service`,
            { revision: session.control_revision, out_of_service: outOfService },
            newKey(),
          );
          appliedSessionSeq.current = next.revision;
          setSession(next);
          return outOfService
            ? copy.serviceOut(block?.name ?? '')
            : copy.serviceIn(block?.name ?? '');
        });
      },
      async issuePacket() {
        if (!session) return;
        setError(null);
        setStatus(copy.issuePacketPending);
        try {
          const issued = await api.post<{ packet: CrewPacket }>(
            `${S()}/packets`,
            { revision: session.session_version },
            newKey(),
          );
          await refreshPackets();
          const deadline = Date.now() + 26_000;
          const poll = async (): Promise<void> => {
            const packet = await api.get<CrewPacket>(
              `${S()}/packets/${issued.packet.id}`,
            );
            setPackets((current) =>
              current.map((row) => (row.id === packet.id ? packet : row)),
            );
            if (packet.state === 'Ready') {
              setStatus(copy.packetReady);
              await refreshPackets();
              return;
            }
            if (packet.state === 'Failed') {
              const message =
                packet.failure === 'valkey_unreachable'
                  ? copy.packetFailedValkey
                  : copy.packetFailedGotenberg;
              setStatus(message);
              setError(message);
              await refreshPackets();
              return;
            }
            if (Date.now() > deadline) return;
            await new Promise((resolve) => setTimeout(resolve, 700));
            await poll();
          };
          await poll();
        } catch (problem) {
          fail(problem);
        }
      },
      refreshPackets,
      async refreshSheet(sheet) {
        try {
          if (sheet === 'members') {
            const list = await api.get<{ members: MemberRow[] }>(
              `${workspacePath(workspaceId)}/members`,
            );
            setMembers(list.members);
          }
          if (sheet === 'trash') {
            const list = await api.get<{ modules: TrashRow[] }>(`${L()}/trash`);
            setTrash(list.modules);
          }
          if (sheet === 'history') {
            const list = await api.get<{ history: HistoryRow[] }>(`${L()}/history`);
            setHistory(list.history);
          }
          if (sheet === 'versions') {
            const list = await api.get<{ versions: LayoutVersionSummary[] }>(`${L()}/versions`);
            setVersions(list.versions);
          }
          if (sheet === 'layouts' || sheet === 'sessions') await refreshLists(workspaceId);
          if (sheet === 'crew-packets') await refreshPackets();
          if (sheet === 'standards') {
            const profile = await api.get<StandardsProfileWithRevision>(
              `${workspacePath(workspaceId)}/standards`,
            );
            setStandards(profile);
          }
        } catch {
          /* the sheet shows what it has */
        }
      },
    };
  }, [
    announce,
    boot,
    bootWorkspace,
    fail,
    layout,
    layoutId,
    loadLayout,
    loadSession,
    me,
    onSceneReset,
    refreshLists,
    refreshPackets,
    selectedModuleId,
    service.valkey,
    session,
    sessionId,
    standards,
    view,
    workspaceId,
  ]);

  const store: AppStore = {
    phase,
    me,
    view,
    role,
    layout,
    session,
    layouts,
    sessions,
    versions,
    packets,
    packetPreview,
    members,
    standards,
    trash,
    history,
    findings,
    status,
    error,
    outage,
    service,
    signInAgain,
    signInAgainFailed,
    snapshotProgress,
    lastTile,
    routePreview,
    blockResults,
    actions,
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
