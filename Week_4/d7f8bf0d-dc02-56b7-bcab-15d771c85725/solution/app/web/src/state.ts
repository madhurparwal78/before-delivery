import { useSyncExternalStore } from 'react'
import type {
  LayoutContent, LayoutDetail, Membership, Role, SessionListItem, SessionSnapshot, StandardsWithRevision,
} from '../../shared/domain'

export type SheetName =
  | 'layouts' | 'versions' | 'timetable' | 'crew-packets' | 'members' | 'standards' | 'history' | 'trash' | 'sessions'
  | 'conflict' | 'deadlock' | 'piece-inspector'

export const SHEET_TITLES: Record<SheetName, string> = {
  layouts: 'Layouts', versions: 'Versions', timetable: 'Timetable', 'crew-packets': 'Crew packets', members: 'Members',
  standards: 'Standards', history: 'History', trash: 'Trash', sessions: 'Sessions', conflict: 'Conflict', deadlock: 'Deadlock',
  'piece-inspector': 'Piece inspector',
}

export interface LayoutListItem { id: string; name: string; revision: number; counts: LayoutDetail['counts'] }

export type DialogState =
  | { kind: 'new-workspace' }
  | { kind: 'add-module' }
  | { kind: 'new-session' }
  | { kind: 'add-extra-train' }
  | { kind: 'rename'; target: 'block' | 'station'; id: string; name: string }

export interface Selection {
  pieceId: string | null
  endId: string | null
  trainNumber: string | null
  blockNumber: number | null
}

export interface UserInfo { id: string; email: string; display_name: string; walkthrough_done: boolean }

export interface AppState {
  boot: 'checking' | 'signed-out' | 'loading' | 'ready'
  user: UserInfo | null
  memberships: Membership[]
  workspaceId: string | null
  role: Role | null
  standards: StandardsWithRevision | null
  layouts: LayoutListItem[]
  layoutId: string | null
  layout: LayoutDetail | null
  versionId: string | null
  sessions: SessionListItem[]
  sessionId: string | null
  session: SessionSnapshot | null
  pinned: LayoutContent | null
  mode: 'build' | 'operate'
  sheet: SheetName | null
  dialog: DialogState | null
  heading: number
  selection: Selection
  newestPieceId: string | null
  lastTile: string | null
  conflictId: string | null
  status: string[]
  errorSheet: string | null
  findings: string[]
  reauth: { email: string } | null
  walkthroughOpen: boolean
  streamDown: boolean
  valkeyDown: boolean
  gotenbergDown: boolean
  // Boot requests finished out of the requests the boot needs; the pill adds the scene's share of finished build stages.
  bootDone: number
  bootTotal: number
  sceneProgress: number
  sceneMode: 'build' | 'operate' | 'paused'
}

const initialState: AppState = {
  boot: 'checking',
  user: null,
  memberships: [],
  workspaceId: null,
  role: null,
  standards: null,
  layouts: [],
  layoutId: null,
  layout: null,
  versionId: null,
  sessions: [],
  sessionId: null,
  session: null,
  pinned: null,
  mode: 'build',
  sheet: null,
  dialog: null,
  heading: 0,
  selection: { pieceId: null, endId: null, trainNumber: null, blockNumber: null },
  newestPieceId: null,
  lastTile: null,
  conflictId: null,
  status: [],
  errorSheet: null,
  findings: [],
  reauth: null,
  walkthroughOpen: false,
  streamDown: false,
  valkeyDown: false,
  gotenbergDown: false,
  bootDone: 0,
  bootTotal: 1,
  sceneProgress: 0,
  sceneMode: 'build',
}

type Listener = () => void

let current: AppState = initialState
const listeners = new Set<Listener>()

export const store = {
  get: (): AppState => current,
  set(change: Partial<AppState> | ((state: AppState) => Partial<AppState>)): void {
    current = { ...current, ...(typeof change === 'function' ? change(current) : change) }
    for (const listener of listeners) listener()
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useSelector<T>(select: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()))
}

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.get)
}

export { canBuild, canManage, canRun } from '../../shared/roles'

// The geometry the stage draws: the working copy while building, the session's pinned version while operating.
export function stageContent(state: AppState): LayoutContent | null {
  return state.mode === 'operate' && state.pinned !== null ? state.pinned : state.layout?.content ?? null
}

const MAX_STATUS = 3

export function say(message: string): void {
  store.set(state => ({ status: [...state.status, message].slice(-MAX_STATUS) }))
}

export function reportError(message: string): void {
  store.set(state => ({ status: [...state.status, message].slice(-MAX_STATUS), errorSheet: message }))
}
