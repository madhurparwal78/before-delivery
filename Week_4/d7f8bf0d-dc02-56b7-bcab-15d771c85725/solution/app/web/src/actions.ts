import type {
  Authority, Conflict, CrewPacket, Finding, LayoutContent, LayoutDetail, LayoutEvent, LayoutModule, LayoutVersion,
  Membership, Piece, PieceBody, SessionEvent, SessionListItem, SessionSnapshot, StandardsWithRevision, TickDetail,
} from '../../shared/domain'
import { standardEndplate, type EndplateType } from '../../shared/endplates'
import { ApiFailure, apiGet, apiPlain, apiWrite, newKey, onSessionEnded } from './api'
import { COPY, packetFailureCopy } from './copy'
import { Feed } from './feed'
import { playRefusal, present, resetPresenter } from './presenter'
import { requestPreview, resetRoute, routeNow } from './route'
import { canRun, say, reportError, store, type LayoutListItem, type SheetName, type UserInfo } from './state'
import { readUrl } from './url'

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ---- the shared command wrapper ---------------------------------------------------------------

type Outcome<T> = { ok: true; value: T } | { ok: false; error: ApiFailure }

function failureCopy(error: ApiFailure): string {
  const findings = error.body?.findings as Finding[] | undefined
  if (error.code === 'validation_failed' && findings !== undefined && findings.length > 0) return findings.map(f => f.message).join(' ')
  return error.message
}

interface Act<T> {
  pending: string | null
  run: () => Promise<T>
  success: (value: T) => string | null
  // Field and rule errors stay in the status region (and under their field); others open the error sheet.
  inline?: boolean
}

export async function act<T>(options: Act<T>): Promise<Outcome<T>> {
  if (options.pending !== null) say(options.pending)
  try {
    const value = await options.run()
    const message = options.success(value)
    if (message !== null) say(message)
    return { ok: true, value }
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error
    const copy = failureCopy(error)
    if (options.inline === true || error.code === 'invalid_fields' || error.code === 'validation_failed') say(copy)
    else reportError(copy)
    return { ok: false, error }
  }
}

// ---- paths ------------------------------------------------------------------------------------

export const workspacePath = (): string => `/api/workspaces/${store.get().workspaceId}`
export const layoutPath = (): string => `${workspacePath()}/layouts/${store.get().layoutId}`
export const sessionPath = (): string => `${workspacePath()}/sessions/${store.get().sessionId}`

// ---- sign-in ----------------------------------------------------------------------------------

let reauthDone: (() => void) | null = null

onSessionEnded(() => new Promise<void>(resolve => {
  reauthDone = resolve
  store.set({ reauth: { email: store.get().user?.email ?? '' } })
}))

async function authenticate(email: string, password: string): Promise<boolean> {
  say(COPY.signingIn)
  try {
    await apiPlain('POST', '/api/auth/sign-in', { email, password })
  } catch (error) {
    say(error instanceof ApiFailure && error.code === 'invalid_credentials' ? COPY.badCredentials : 'Sign-in failed. Try again.')
    return false
  }
  say(COPY.signedIn)
  return true
}

export async function signInAgain(password: string): Promise<boolean> {
  if (!(await authenticate(store.get().reauth?.email ?? '', password))) return false
  store.set({ reauth: null })
  reauthDone?.()
  reauthDone = null
  return true
}

export async function signIn(email: string, password: string): Promise<boolean> {
  if (!(await authenticate(email, password))) return false
  await bootstrap()
  return true
}

export async function signOut(): Promise<void> {
  await apiPlain('POST', '/api/auth/sign-out', {}).catch(() => undefined)
  stopFeeds()
  resetPresenter()
  resetRoute()
  store.set({ boot: 'signed-out', user: null, workspaceId: null, layout: null, layoutId: null, session: null, sessionId: null, pinned: null, sheet: null, dialog: null, bootDone: 0 })
}

// ---- boot and loading -------------------------------------------------------------------------

async function fetchMe(): Promise<{ user: UserInfo; memberships: Membership[] } | null> {
  const answer = await fetch('/api/me', { credentials: 'same-origin' })
  const body = (await answer.json()) as { user: UserInfo; memberships: Membership[] }
  return answer.ok ? body : null
}

function bootStepsDone(steps: number): void {
  store.set(state => (state.boot === 'loading' ? { bootDone: state.bootDone + steps } : {}))
}

export async function bootstrap(): Promise<void> {
  const me = await fetchMe()
  if (me === null) {
    store.set({ boot: 'signed-out', bootDone: 0 })
    return
  }
  const url = readUrl()
  // Until the workspace's lists say otherwise the boot expects this answer, the workspace, its layouts and sessions, and a layout.
  store.set({ boot: 'loading', bootDone: 1, bootTotal: 5, user: me.user, memberships: me.memberships, walkthroughOpen: !me.user.walkthrough_done })
  const first = me.memberships.find(item => item.workspace_id === url.workspace) ?? me.memberships[0]
  if (first === undefined) {
    store.set({ boot: 'ready' })
    return
  }
  store.set({ heading: url.heading, selection: { pieceId: url.piece, endId: url.end, trainNumber: url.train, blockNumber: url.block }, sheet: url.sheet, versionId: url.version })
  await openWorkspace(first.workspace_id, { layoutId: url.layout, sessionId: url.session, mode: url.mode })
}

export async function openWorkspace(workspaceId: string, want: { layoutId?: string | null; sessionId?: string | null; mode?: 'build' | 'operate' } = {}): Promise<void> {
  stopFeeds()
  resetPresenter()
  resetRoute()
  const role = store.get().memberships.find(item => item.workspace_id === workspaceId)?.role ?? null
  store.set({
    workspaceId, role, layout: null, layoutId: null, session: null, sessionId: null, pinned: null, mode: 'build',
    selection: want.layoutId === undefined ? { pieceId: null, endId: null, trainNumber: null, blockNumber: null } : store.get().selection,
    ...(want.layoutId === undefined ? { sheet: null, versionId: null } : {}),
  })
  const [workspace, layouts, sessions] = await Promise.all([
    apiGet<{ standards: StandardsWithRevision }>(workspacePath()),
    apiGet<{ layouts: LayoutListItem[] }>(`${workspacePath()}/layouts`),
    apiGet<{ sessions: SessionListItem[] }>(`${workspacePath()}/sessions`),
  ])
  store.set({ standards: workspace.standards, layouts: layouts.layouts, sessions: sessions.sessions })
  bootStepsDone(3)
  const layoutId = layouts.layouts.find(item => item.id === want.layoutId)?.id ?? layouts.layouts[0]?.id ?? null
  const sessionId = sessions.sessions.find(item => item.id === want.sessionId)?.id ?? null
  // The boot is this answer, the workspace with its layouts and sessions, the layout, and an open session's snapshot and version.
  store.set({ bootTotal: 4 + (layoutId === null ? 0 : 1) + (sessionId === null ? 0 : 2) })
  if (layoutId !== null) await loadLayout(layoutId)
  if (sessionId !== null) await openSession(sessionId, want.mode ?? 'build')
  if (store.get().boot !== 'ready') store.set({ boot: 'loading' })
}

export async function loadLayout(layoutId: string): Promise<void> {
  store.set({ layoutId })
  const layout = await apiGet<LayoutDetail>(layoutPath())
  store.set({ layout })
  bootStepsDone(1)
  layoutFeed?.stop()
  layoutFeed = new Feed(`${layoutPath()}/events`, () => store.get().layout?.revision ?? 0, {
    onEvent: (seq, _type, data) => applyLayoutEvent(seq, data as LayoutEvent),
    onResync: () => void refreshLayout(),
    onUp: feedUp,
    onDown: feedDown,
  })
  layoutFeed.start()
}

let refreshing = false
let refreshAgain = false

export async function refreshLayout(): Promise<void> {
  if (refreshing) {
    refreshAgain = true
    return
  }
  refreshing = true
  try {
    do {
      refreshAgain = false
      const layout = await apiGet<LayoutDetail>(layoutPath())
      store.set(state => ({
        layout,
        layouts: state.layouts.map(item => (item.id === layout.id ? { ...item, name: layout.name, revision: layout.revision, counts: layout.counts } : item)),
      }))
    } while (refreshAgain)
  } finally {
    refreshing = false
  }
}

function applyLayoutEvent(seq: number, event: LayoutEvent): void {
  const layout = store.get().layout
  if (layout === null || seq <= layout.revision) return
  store.set(state => ({ layouts: state.layouts.map(item => (item.id === state.layoutId ? { ...item, counts: event.layout.counts, revision: seq } : item)) }))
  void refreshLayout()
}

export async function refreshWorkspaceLists(): Promise<void> {
  const [layouts, sessions] = await Promise.all([
    apiGet<{ layouts: LayoutListItem[] }>(`${workspacePath()}/layouts`),
    apiGet<{ sessions: SessionListItem[] }>(`${workspacePath()}/sessions`),
  ])
  store.set({ layouts: layouts.layouts, sessions: sessions.sessions })
}

export async function openSession(sessionId: string, mode: 'build' | 'operate' = 'operate'): Promise<void> {
  sessionFeed?.stop()
  resetRoute()
  store.set({ sessionId })
  const snapshot = await apiGet<SessionSnapshot>(sessionPath())
  const version = await apiGet<{ content: LayoutContent }>(`${layoutPath()}/versions/${snapshot.layout_version_id}`)
  bootStepsDone(2)
  store.set(state => ({
    session: snapshot, pinned: version.content, mode, versionId: state.versionId ?? snapshot.layout_version_id,
    selection: { ...state.selection, trainNumber: snapshot.trains.some(t => t.number === state.selection.trainNumber) ? state.selection.trainNumber : null },
  }))
  present(snapshot, reducedMotion())
  sessionFeed = new Feed(`${sessionPath()}/events`, () => store.get().session?.revision ?? 0, {
    onEvent: (seq, _type, data) => applySessionEvent(seq, data as SessionEvent<Record<string, unknown>>),
    onResync: () => void refreshSession(),
    onUp: feedUp,
    onDown: feedDown,
  })
  sessionFeed.start()
}

export function closeSession(): void {
  sessionFeed?.stop()
  sessionFeed = null
  resetPresenter()
  resetRoute()
  store.set({ session: null, sessionId: null, pinned: null, mode: 'build', selection: { ...store.get().selection, trainNumber: null, blockNumber: null } })
}

async function refreshSession(): Promise<void> {
  if (store.get().sessionId === null) return
  const snapshot = await apiGet<SessionSnapshot>(sessionPath())
  adoptSnapshot(snapshot)
}

// A snapshot is applied only when it is newer than what is on screen, so an older answer never rewinds the scene.
export function adoptSnapshot(snapshot: SessionSnapshot): void {
  const current = store.get().session
  if (current !== null && snapshot.revision <= current.revision && snapshot.id === current.id) return
  store.set({ session: snapshot })
  present(snapshot, reducedMotion())
}

// ---- events -----------------------------------------------------------------------------------

const myRefusals = new Set<string>()
const myPackets = new Set<string>()
let sessionFeed: Feed | null = null
let layoutFeed: Feed | null = null
let poll = 0
let wasDown = false

function stopFeeds(): void {
  sessionFeed?.stop()
  layoutFeed?.stop()
  sessionFeed = null
  layoutFeed = null
  window.clearInterval(poll)
  poll = 0
  store.set({ streamDown: false, valkeyDown: false })
}

function feedUp(): void {
  if (!wasDown) return
  wasDown = false
  store.set({ streamDown: false, valkeyDown: false })
  say(COPY.valkeyBack)
  window.clearInterval(poll)
  poll = 0
  void refreshSession().catch(() => undefined)
  void refreshLayout().catch(() => undefined)
}

// While the event stream is unavailable the browser re-reads the session snapshot every 3 seconds.
function feedDown(code: string): void {
  wasDown = true
  store.set({ streamDown: true, valkeyDown: code === 'valkey_unavailable' || store.get().valkeyDown })
  if (poll === 0) {
    poll = window.setInterval(() => void refreshSession().catch(() => undefined), 3000)
  }
}

function applySessionEvent(seq: number, event: SessionEvent<Record<string, unknown>>): void {
  const current = store.get().session
  if (current === null || seq <= current.revision) return
  if (seq > current.revision + 1) {
    void refreshSession()
    return
  }
  adoptSnapshot(event.session)
  const state = store.get()
  if (event.type === 'tick.committed') {
    const detail = event.detail as unknown as TickDetail
    for (const revoked of detail.authorities_revoked) {
      if (revoked.ended_reason === 'expired') say(COPY.authorityExpired(revoked.train_number))
    }
    for (const raised of detail.deadlocks_raised) {
      say(COPY.deadlock(raised.train_numbers))
      if (canRun(store.get().role) && (state.sheet === null || state.sheet === 'conflict')) store.set({ sheet: 'deadlock' })
    }
  } else if (event.type === 'authority.refused') {
    const authority = event.detail.authority as Authority
    const conflict = event.detail.conflict as Conflict
    const reachable = authority.block_ids.slice(0, authority.block_ids.indexOf(conflict.block_id))
    playRefusal(authority.id, reachable.map(id => event.session.blocks.find(block => block.id === id)?.number ?? 0))
  } else if (event.type === 'packet.changed') {
    const packet = event.detail.packet as CrewPacket
    if (myPackets.has(packet.id) && packet.state === 'Ready') say(COPY.packetReady)
    if (myPackets.has(packet.id) && packet.state === 'Failed') say(packetFailureCopy(packet.failure))
  } else if (event.type === 'session.status' && event.session.hold_reason === 'valkey') {
    store.set({ valkeyDown: true })
  }
  if (event.session.hold_reason !== 'valkey' && store.get().valkeyDown && !store.get().streamDown) store.set({ valkeyDown: false })
}

// ---- selection and sheets ---------------------------------------------------------------------

export function openSheet(name: SheetName): void {
  store.set({ sheet: name })
}

export function closeSheet(): void {
  const sheet = store.get().sheet
  store.set(sheet === 'piece-inspector' ? { sheet: null, selection: { ...store.get().selection, pieceId: null } } : { sheet: null })
}

export function selectTrain(number: string | null): void {
  store.set(state => ({ selection: { ...state.selection, trainNumber: number } }))
  requestPreview()
}

export function selectBlock(number: number | null): void {
  store.set(state => ({ selection: { ...state.selection, blockNumber: number } }))
}

export function selectPiece(id: string | null): void {
  store.set(state => ({ selection: { ...state.selection, pieceId: id }, sheet: id === null ? state.sheet : 'piece-inspector' }))
}

export function selectOpenEnd(id: string | null): void {
  store.set(state => ({ selection: { ...state.selection, endId: id } }))
}

export function setMode(mode: 'build' | 'operate'): void {
  if (mode === 'operate' && store.get().sessionId === null) {
    store.set({ sheet: 'sessions' })
    return
  }
  store.set({ mode })
}

export function setHeading(degrees: number): void {
  store.set({ heading: ((degrees % 360) + 360) % 360 })
}

// ---- the layout in Build mode -----------------------------------------------------------------

interface Tile { name: string; body: PieceBody }

export const TILES: Tile[] = [
  { name: 'Straight 12 in', body: { kind: 'straight', length_mm: 305, rise_mm: 0, mainline: true } },
  { name: 'Straight 6 in', body: { kind: 'straight', length_mm: 152, rise_mm: 0, mainline: true } },
  { name: 'Curve left', body: { kind: 'curve', radius_mm: 1067, angle_deg: 15, hand: 'left', rise_mm: 0, mainline: true } },
  { name: 'Curve right', body: { kind: 'curve', radius_mm: 1067, angle_deg: 15, hand: 'right', rise_mm: 0, mainline: true } },
  { name: 'Turnout left', body: { kind: 'turnout', frog_number: 6, hand: 'left', length_mm: 305, rise_mm: 0, mainline: true } },
  { name: 'Turnout right', body: { kind: 'turnout', frog_number: 6, hand: 'right', length_mm: 305, rise_mm: 0, mainline: true } },
  { name: 'Rise', body: { kind: 'straight', length_mm: 1219, rise_mm: 19, mainline: true } },
  { name: 'Fall', body: { kind: 'straight', length_mm: 1219, rise_mm: -19, mainline: true } },
]

export function moduleOfSelection(layout: LayoutDetail | null, selection: { pieceId: string | null; endId: string | null }): LayoutModule | undefined {
  return layout?.content.modules.find(module =>
    (selection.pieceId !== null && module.pieces.some(piece => piece.id === selection.pieceId))
    || (selection.endId !== null && module.open_ends.some(end => end.id === selection.endId)))
}

// The selected open end, or the newest open end of the selected module.
function tileTarget(): { module: LayoutModule; endId: string } | null {
  const { layout, selection } = store.get()
  const module = moduleOfSelection(layout, selection)
  if (module === undefined) return null
  const chosen = module.open_ends.find(end => end.id === selection.endId) ?? module.open_ends[module.open_ends.length - 1]
  return chosen === undefined ? null : { module, endId: chosen.id }
}

let appending = false

// One press sends one append command with one key; further presses while it is pending send nothing new.
export async function pressTile(tile: Tile): Promise<void> {
  if (appending) return
  const target = tileTarget()
  const layout = store.get().layout
  if (target === null || layout === null) {
    say('Select an open end first.')
    return
  }
  appending = true
  store.set({ lastTile: tile.name })
  const key = newKey()
  const done = await act({
    pending: COPY.addingPiece,
    run: () => apiWrite<{ piece: Piece; open_ends: LayoutModule['open_ends'] }>('POST', `${layoutPath()}/modules/${target.module.id}/pieces`,
      { revision: layout.module_revisions[target.module.id], open_end_id: target.endId, piece: tile.body }, key),
    success: () => (store.get().streamDown ? COPY.savedWhileValkeyDown : COPY.pieceAdded),
  })
  try {
    if (done.ok) {
      const next = done.value.open_ends.find(end => end.piece_id === done.value.piece.id)
      await refreshLayout()
      store.set(state => ({ newestPieceId: done.value.piece.id, selection: { ...state.selection, endId: next?.id ?? state.selection.endId, pieceId: state.sheet === 'piece-inspector' ? state.selection.pieceId : null } }))
    } else {
      await refreshLayout().catch(() => undefined)
    }
  } finally {
    appending = false
  }
}

export async function undoLastPiece(): Promise<void> {
  const { layout, selection, user } = store.get()
  if (layout === null || user === null || appending) return
  const module = moduleOfSelection(layout, selection) ?? layout.content.modules.find(candidate => candidate.pieces.some(piece => piece.added_by === user.id))
  const mine = module?.pieces.filter(piece => piece.added_by === user.id) ?? []
  const newest = mine[mine.length - 1]
  if (module === undefined || newest === undefined) {
    say('Nothing to undo.')
    return
  }
  appending = true
  const done = await act({
    pending: COPY.removingPiece,
    run: () => apiWrite<{ open_ends: LayoutModule['open_ends'] }>('POST', `${layoutPath()}/modules/${module.id}/pieces/${newest.id}/remove`, { revision: layout.module_revisions[module.id] }),
    success: () => COPY.pieceRemoved,
  })
  try {
    await refreshLayout().catch(() => undefined)
    if (done.ok) store.set(state => ({ selection: { ...state.selection, pieceId: null, endId: done.value.open_ends.find(end => end.id === newest.open_end_id)?.id ?? state.selection.endId } }))
  } finally {
    appending = false
  }
}

export async function createModule(name: string, endplate: EndplateType): Promise<Outcome<LayoutModule>> {
  const { layout, standards } = store.get()
  if (layout === null || standards === null) throw new Error('layout is not loaded')
  const plates = (['A', 'B'] as const).map(end => ({ end, ...standardEndplate(endplate, standards) }))
  const done = await act({
    pending: COPY.addingModule,
    run: () => apiWrite<{ module: LayoutModule }>('POST', `${layoutPath()}/modules`, { revision: layout.revision, name, endplates: plates }),
    success: () => COPY.moduleAdded,
    inline: true,
  })
  if (!done.ok) return done
  await refreshLayout()
  const added = done.value.module
  store.set(state => ({ selection: { ...state.selection, pieceId: null, endId: added.open_ends[0]?.id ?? null } }))
  return { ok: true, value: added }
}

export async function trashSelectedModule(): Promise<void> {
  const { layout, selection } = store.get()
  const module = moduleOfSelection(layout, selection)
  if (layout === null || module === undefined) return
  const done = await act({
    pending: COPY.movingToTrash,
    run: () => apiWrite('POST', `${layoutPath()}/modules/${module.id}/trash`, { revision: layout.revision }),
    success: () => COPY.movedToTrash,
  })
  if (done.ok) {
    store.set(state => ({ selection: { ...state.selection, pieceId: null, endId: null }, sheet: state.sheet === 'piece-inspector' ? null : state.sheet }))
    await refreshLayout()
  }
}

export async function checkLayout(): Promise<void> {
  const done = await act({
    pending: COPY.checkingLayout,
    run: () => apiPlain<{ passed: boolean; findings: Finding[] }>('POST', `${layoutPath()}/check`, {}),
    success: report => (report.passed ? COPY.layoutPasses : COPY.layoutFindings(report.findings.length)),
  })
  if (done.ok) store.set({ findings: done.value.findings.map(finding => finding.message) })
}

let saving = false

export async function saveVersion(): Promise<void> {
  const layout = store.get().layout
  if (saving || layout === null) return
  saving = true
  try {
    const done = await act({
      pending: COPY.savingVersion,
      run: async () => {
        const { versions } = await apiGet<{ versions: LayoutVersion[] }>(`${layoutPath()}/versions`)
        const label = `Issue ${Math.max(0, ...versions.map(version => version.number)) + 1}`
        return apiWrite<{ version: LayoutVersion }>('POST', `${layoutPath()}/versions`, { revision: store.get().layout?.revision ?? layout.revision, label })
      },
      success: answer => COPY.versionSaved(answer.version.number),
    })
    if (done.ok) await refreshLayout().catch(() => undefined)
  } finally {
    saving = false
  }
}

// ---- Operate mode -----------------------------------------------------------------------------

function blockName(snapshot: SessionSnapshot, id: string): string {
  return snapshot.blocks.find(block => block.id === id)?.name ?? ''
}

function selectedTrain(): SessionSnapshot['trains'][number] | undefined {
  const { session, selection } = store.get()
  return session?.trains.find(train => train.number === selection.trainNumber)
}

export async function highball(): Promise<void> {
  const state = store.get()
  const train = selectedTrain()
  const route = routeNow()
  if (state.session === null) return
  if (train === undefined || route.destination === '') {
    say('Select a train and a destination first.')
    return
  }
  const done = await act({
    pending: COPY.requestingRoad(train.number),
    run: () => apiWrite<{ authority: Authority; session: SessionSnapshot }>('POST', `${sessionPath()}/trains/${train.id}/authorities`, {
      revision: train.revision,
      destination_block_id: route.destination,
      via_block_id: route.via === '' ? null : route.via,
      time_limit_fast_seconds: route.limitMinutes * 60,
    }),
    success: answer => COPY.hasRoad(train.number, blockName(answer.session, answer.authority.limit_block_id), answer.authority.block_ids.length),
    inline: true,
  })
  if (done.ok) {
    adoptSnapshot(done.value.session)
    return
  }
  const body = done.error.body
  if (done.error.code === 'route_conflict' && body !== null) {
    const conflict = body.conflict as Conflict
    const authority = body.authority as Authority
    const snapshot = store.get().session
    const blockLabel = snapshot === null ? '' : blockName(snapshot, conflict.block_id)
    const other = snapshot?.trains.find(candidate => candidate.id === conflict.other_train_id)
    say(other === undefined ? COPY.refusedOutOfService(train.number, blockLabel) : COPY.refusedHeld(train.number, blockLabel, other.number))
    myRefusals.add(authority.id)
    store.set({ conflictId: conflict.id, sheet: 'conflict' })
    await refreshSession().catch(() => undefined)
  } else if (done.error.code !== 'validation_failed' && done.error.code !== 'invalid_fields') {
    reportError(done.error.message)
  }
}

export async function recallSelected(): Promise<void> {
  const train = selectedTrain()
  if (train === undefined) say('Select a train first.')
  else await moveTrain(train.number, 'recall')
}

export async function moveTrain(number: string, command: 'back-to-loop' | 'recall'): Promise<void> {
  const snapshot = store.get().session
  const train = snapshot?.trains.find(candidate => candidate.number === number)
  if (snapshot === undefined || snapshot === null || train === undefined) return
  const done = await act({
    pending: command === 'recall' ? COPY.recalling(number) : COPY.sendingToLoop(number),
    run: () => apiWrite<SessionSnapshot>('POST', `${sessionPath()}/trains/${train.id}/${command}`, { revision: train.revision }),
    success: answer => {
      const block = blockName(answer, answer.trains.find(candidate => candidate.number === number)?.head_block_id ?? '')
      return command === 'recall' ? COPY.recalled(number, block) : COPY.inBlock(number, block)
    },
  })
  if (done.ok) {
    adoptSnapshot(done.value)
    store.set(state => (state.sheet === 'conflict' || state.sheet === 'deadlock' ? { sheet: null } : {}))
  }
}

export async function cancelAuthority(): Promise<void> {
  const { session } = store.get()
  const train = selectedTrain()
  const authority = session?.authorities.find(candidate => candidate.state === 'Granted' && candidate.train_id === train?.id)
  if (session === null || authority === undefined) {
    say('Select a train that has the road.')
    return
  }
  const done = await act({
    pending: COPY.cancellingAuthority,
    run: () => apiWrite<{ session: SessionSnapshot }>('POST', `${sessionPath()}/authorities/${authority.id}/cancel`, { revision: authority.revision }),
    success: () => COPY.authorityReleased,
  })
  if (done.ok) adoptSnapshot(done.value.session)
}

export async function sessionCommand(command: 'start' | 'hold' | 'resume' | 'end'): Promise<void> {
  const session = store.get().session
  if (session === null) return
  const copy = {
    start: [COPY.startingSession, () => COPY.sessionRunning],
    hold: [COPY.holdingSession, (s: SessionSnapshot) => COPY.sessionHeld(s.tick)],
    resume: [COPY.resumingSession, (s: SessionSnapshot) => COPY.sessionResumed(s.tick)],
    end: [COPY.endingSession, () => COPY.sessionEnded],
  } as const
  const [pending, success] = copy[command]
  const done = await act({
    pending,
    run: () => apiWrite<SessionSnapshot>('POST', `${sessionPath()}/${command}`, { revision: session.control_revision }),
    success,
  })
  if (done.ok) {
    adoptSnapshot(done.value)
    void refreshWorkspaceLists().catch(() => undefined)
  }
}

export async function setOutOfService(blockId: string, out: boolean): Promise<void> {
  const session = store.get().session
  if (session === null) return
  const name = blockName(session, blockId)
  const number = session.blocks.find(block => block.id === blockId)?.number ?? 0
  const done = await act({
    pending: COPY.changingBlock,
    run: () => apiWrite<SessionSnapshot>('POST', `${sessionPath()}/blocks/${blockId}/service`, { revision: session.control_revision, out_of_service: out }),
    success: () => (out ? COPY.blockOut(`${number} ${name}`) : COPY.blockBack(`${number} ${name}`)),
  })
  if (done.ok) adoptSnapshot(done.value)
}

export async function saveNote(conflict: Conflict, note: string): Promise<void> {
  const done = await act({
    pending: COPY.savingNote,
    run: () => apiWrite<{ conflict: Conflict }>('PATCH', `${sessionPath()}/conflicts/${conflict.id}`, { revision: conflict.revision, note }),
    success: () => COPY.noteSaved,
  })
  if (done.ok) await refreshSession().catch(() => undefined)
}

export async function withdrawRequest(conflict: Conflict): Promise<void> {
  const done = await act({
    pending: COPY.withdrawing,
    run: () => apiWrite<SessionSnapshot>('POST', `${sessionPath()}/conflicts/${conflict.id}/withdraw`, { revision: conflict.revision }),
    success: () => COPY.withdrawn,
  })
  if (done.ok) {
    adoptSnapshot(done.value)
    store.set({ sheet: null, conflictId: null })
  }
}

function noteIssuedPacket(packetId: string): void {
  myPackets.add(packetId)
}

export async function issuePacket(): Promise<void> {
  const session = store.get().session
  if (session === null) return
  const done = await act({
    pending: COPY.issuingPacket,
    run: () => apiWrite<{ packet: CrewPacket }>('POST', `${sessionPath()}/packets`, { revision: session.session_version }),
    success: () => null,
  })
  if (done.ok) noteIssuedPacket(done.value.packet.id)
}

export async function finishWalkthrough(): Promise<void> {
  if (!store.get().walkthroughOpen) return
  store.set(state => ({ walkthroughOpen: false, user: state.user === null ? null : { ...state.user, walkthrough_done: true } }))
  await apiPlain('POST', '/api/me/walkthrough', { done: true }).catch(() => undefined)
}

export async function pollGotenberg(): Promise<void> {
  const status = await apiGet<{ gotenberg: 'up' | 'down' }>('/api/status').catch(() => null)
  if (status !== null) store.set({ gotenbergDown: status.gotenberg === 'down' })
}

export function dismissError(): void {
  store.set({ errorSheet: null })
}
