// The editor's brain: loads the score, keeps the voices, sends stamped operation batches, follows the live
// session and serves every region of the workspace with the state it needs. React reads it as a store.

import { MeasureGrid, type DurationName } from '../shared/music.js'
import type {
  Bank, Collaborator, EngravingPage, HistoryEntry, Hold, LogEntry, Part, PresenceCursor, PresenceEntry, ScoreSummary, ServerMessage, SystemSvg, VoiceResponse,
} from '../shared/protocol.js'
import { Voice, type ElementId, type Operation, type VoiceElement } from '../shared/voice.js'
import { api, ApiFailure, seatToken } from './api.js'
import { Playback } from './audio/playback.js'

export type NoticeKey = 'Entry' | 'Sync queue' | 'Holds' | 'Score changes' | 'Team' | 'Parts' | 'Sample banks' | 'Playback' | 'History' | 'Layout' | 'Text' | 'View'
type SyncState = 'connecting' | 'live' | 'paused' | 'restored'

export interface EntryState {
  staffId: string
  voice: 1 | 2
  duration: DurationName
  dotted: boolean
  /** The current note: the event just before the caret; null puts the caret at the start of the voice. */
  current: ElementId | null
}

export interface Snapshot {
  phase: 'loading' | 'ready' | 'invalid' | 'removed'
  me: Collaborator | null
  score: ScoreSummary | null
  parts: Part[]
  holds: Hold[]
  presence: PresenceEntry[]
  collaborators: Collaborator[]
  banks: Bank[]
  sync: SyncState
  connectionId: string | null
  systems: SystemSvg[] | null
  entry: EntryState
  selection: string[]
  notices: Record<NoticeKey, string>
  voiceVersion: number
  playing: boolean
  position: { measure: number; beat: number } | null
  partSystems: Record<string, { systems: SystemSvg[]; key: string }>
  /** Ids of notes other collaborators just added; they fade in. */
  fadeIds: Set<string>
}

const NOTICE_KEYS: NoticeKey[] = ['Entry', 'Sync queue', 'Holds', 'Score changes', 'Team', 'Parts', 'Sample banks', 'Playback', 'History', 'Layout', 'Text', 'View']
const BATCH_DELAY_MS = 250
const HEARTBEAT_MS = 5000
const CATCH_UP_MS = 5000
const RESTORED_MS = 3000

const initial = (): Snapshot => ({
  phase: 'loading', me: null, score: null, parts: [], holds: [], presence: [], collaborators: [], banks: [], sync: 'connecting', connectionId: null,
  systems: null, entry: { staffId: '', voice: 1, duration: 'quarter', dotted: false, current: null }, selection: [],
  notices: Object.fromEntries(NOTICE_KEYS.map((k) => [k, ''])) as Record<NoticeKey, string>, voiceVersion: 0, playing: false, position: null,
  partSystems: {}, fadeIds: new Set(),
})

const voiceKey = (staffId: string, voice: number): string => `${staffId}:${voice}`

export class Session {
  private snapshot: Snapshot = initial()
  private readonly listeners = new Set<() => void>()
  private readonly voices = new Map<string, Voice>()
  private grid = new MeasureGrid([{ measure: 1, beats: 4, beatType: 4 }])
  private clock = 0
  private lastSeq = 0
  private socket: WebSocket | null = null
  private socketTimer = 0
  private heartbeatTimer = 0
  private catchUpTimer = 0
  private restoredTimer = 0
  private cursor: PresenceCursor | null = null
  private outbox: Operation[] = []
  private flushTimer = 0
  private inflight = false
  private waitTimer = 0
  private waitLeft = 0
  private offline = false
  private waited = false
  private engraveTimer = 0
  private engraveRun = 0
  private reconcileTimer = 0
  private readonly stale = new Set<string>()
  private partsTimer = 0
  private disposed = false
  private playback: Playback | null = null
  readonly historyListeners = new Set<(entries: LogEntry[]) => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): Snapshot => this.snapshot

  private set(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  notice(key: NoticeKey, text: string): void {
    this.set({ notices: { ...this.snapshot.notices, [key]: text } })
  }

  get me(): Collaborator {
    return this.snapshot.me as Collaborator
  }

  private id = ''

  get scoreId(): string {
    return this.id
  }

  eventsOf(staffId: string, voice: 1 | 2): ReturnType<Voice['events']> {
    return this.voice(staffId, voice).events(this.grid)
  }

  private voice(staffId: string, voice: number): Voice {
    const key = voiceKey(staffId, voice)
    let found = this.voices.get(key)
    if (!found) {
      found = new Voice()
      this.voices.set(key, found)
    }
    return found
  }

  /** The grid positions events with the current time signatures. */
  get measureGrid(): MeasureGrid {
    return this.grid
  }

  // ----- loading -----

  async start(): Promise<void> {
    if (!seatToken()) {
      this.set({ phase: 'invalid' })
      return
    }
    try {
      const me = await api<{ collaborator: Collaborator; score: { id: string } }>('GET', '/api/me')
      this.id = me.score.id
      const [score, parts, holds, presence, collaborators, banks] = await Promise.all([
        api<{ score: ScoreSummary }>('GET', `/api/scores/${me.score.id}`),
        api<{ parts: Part[] }>('GET', `/api/scores/${me.score.id}/parts`),
        api<{ holds: Hold[] }>('GET', `/api/scores/${me.score.id}/holds`),
        api<{ entries: PresenceEntry[] }>('GET', `/api/scores/${me.score.id}/presence`),
        api<{ collaborators: Collaborator[] }>('GET', `/api/scores/${me.score.id}/collaborators`),
        api<{ banks: Bank[] }>('GET', `/api/scores/${me.score.id}/banks`),
      ])
      this.clock = score.score.lamport
      this.lastSeq = score.score.lastSeq
      this.grid = new MeasureGrid(score.score.timeSignatures)
      const own = me.collaborator.role === 'player' ? score.score.staves.find((s) => me.collaborator.staffIds.includes(s.id)) : undefined
      const first = own ?? score.score.staves[0]
      await this.loadVoices(score.score.staves.map((s) => s.id))
      this.set({
        phase: 'ready', me: me.collaborator, score: score.score, parts: parts.parts, holds: holds.holds, presence: presence.entries,
        collaborators: collaborators.collaborators, banks: banks.banks, entry: { ...this.snapshot.entry, staffId: first?.id ?? '' },
        selection: [],
      })
      this.connect()
      this.scheduleEngraving(0)
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) this.set({ phase: 'invalid' })
      else window.setTimeout(() => void this.start(), 2000)
    }
  }

  dispose(): void {
    this.disposed = true
    this.playback?.dispose()
    this.socket?.close()
    for (const t of [this.socketTimer, this.heartbeatTimer, this.catchUpTimer, this.restoredTimer, this.flushTimer, this.waitTimer, this.engraveTimer, this.reconcileTimer, this.partsTimer]) {
      window.clearTimeout(t)
      window.clearInterval(t)
    }
  }

  private async loadVoices(staffIds: string[]): Promise<void> {
    const queue = [...staffIds]
    const worker = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        for (const voice of [1, 2] as const) await this.reloadVoice(id, voice)
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
  }

  private async reloadVoice(staffId: string, voice: 1 | 2): Promise<void> {
    const response = await api<VoiceResponse>('GET', `/api/scores/${this.scoreId}/staves/${staffId}/voices/${voice}`).catch(() => null)
    if (!response) return
    const target = this.voice(staffId, voice)
    target.elements = response.events.map((e): VoiceElement => ({
      id: e.id, kind: e.kind, pitch: e.pitch, duration: e.duration, dots: e.dots, tie: e.tie, dynamic: e.dynamic,
      dynamicPlacement: e.dynamicPlacement ?? 'below', text: e.text, stamps: {}, deleted: null,
    }))
    target.byId.clear()
    for (const e of target.elements) target.byId.set(`${e.id.lamport}@${e.id.site}`, e)
    for (const op of this.outbox) if (op.staffId === staffId && op.voice === voice) target.apply(op)
    this.set({ voiceVersion: this.snapshot.voiceVersion + 1 })
  }

  // ----- live session -----

  private connect(): void {
    if (this.disposed) return
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${protocol}://${location.host}/api/scores/${this.scoreId}/live?token=${encodeURIComponent(seatToken() ?? '')}`)
    this.socket = socket
    socket.onmessage = (event) => this.onMessage(JSON.parse(String(event.data)) as ServerMessage)
    socket.onclose = () => {
      if (this.socket !== socket || this.disposed) return
      this.socket = null
      window.clearInterval(this.heartbeatTimer)
      this.set({ connectionId: null, sync: this.snapshot.phase === 'removed' ? this.snapshot.sync : 'paused' })
      this.armCatchUp()
      if (this.snapshot.phase === 'ready') this.socketTimer = window.setTimeout(() => this.connect(), 1500)
    }
  }

  private onMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
        this.set({ connectionId: message.connectionId, sync: message.live ? 'live' : 'paused' })
        this.clock = Math.max(this.clock, message.lamport)
        if (message.lastSeq > this.lastSeq) void this.catchUp()
        this.sendHeartbeat()
        window.clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = window.setInterval(() => this.sendHeartbeat(), HEARTBEAT_MS)
        this.armCatchUp()
        break
      case 'ops':
        this.applyEntries(message.entries)
        break
      case 'presence':
        this.set({ presence: message.entries })
        break
      case 'holds':
        this.set({ holds: message.holds })
        break
      case 'part':
        this.onPart(message.part)
        break
      case 'bank':
        if (!this.snapshot.banks.some((b) => b.id === message.bank.id)) this.set({ banks: [message.bank, ...this.snapshot.banks] })
        break
      case 'score':
        void this.onScore(message.score)
        break
      case 'collaborators':
        this.onTeam(message.collaborators)
        break
      case 'live':
        this.onLive(message.live)
        break
      case 'removed':
        this.set({ phase: 'removed' })
        break
    }
  }

  private onLive(live: boolean): void {
    window.clearTimeout(this.restoredTimer)
    if (live) {
      this.set({ sync: 'restored' })
      this.restoredTimer = window.setTimeout(() => this.set({ sync: 'live' }), RESTORED_MS)
      void this.catchUp()
    } else {
      this.set({ sync: 'paused' })
    }
    this.armCatchUp()
  }

  /** While live sync is paused, or the socket is down, missed operations are fetched every 5 seconds. */
  private armCatchUp(): void {
    window.clearInterval(this.catchUpTimer)
    if (this.snapshot.sync === 'paused') this.catchUpTimer = window.setInterval(() => void this.catchUp(), CATCH_UP_MS)
  }

  private sendHeartbeat(): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'heartbeat', cursor: this.cursor, seen: this.clock }))
  }

  setCursor(cursor: PresenceCursor | null): void {
    const same = this.cursor && cursor && this.cursor.staffId === cursor.staffId && this.cursor.measure === cursor.measure && this.cursor.beat === cursor.beat
    this.cursor = cursor
    if (!same) this.sendHeartbeat()
  }

  async catchUp(): Promise<void> {
    try {
      for (;;) {
        const page = await api<{ ops: LogEntry[] }>('GET', `/api/scores/${this.scoreId}/ops?afterSeq=${this.lastSeq}&limit=500`)
        if (page.ops.length === 0) return
        this.applyEntries(page.ops)
      }
    } catch {
      // the next catch-up tick tries again
    }
  }

  private applyEntries(entries: LogEntry[]): void {
    const fresh = entries.filter((e) => e.seq > this.lastSeq).sort((a, b) => a.seq - b.seq)
    if (fresh.length === 0) return
    if ((fresh[0] as LogEntry).seq > this.lastSeq + 1) {
      void this.catchUp()
      return
    }
    const added: string[] = []
    for (const entry of fresh) {
      this.lastSeq = entry.seq
      this.clock = Math.max(this.clock, entry.op.id.lamport)
      this.voice(entry.op.staffId, entry.op.voice).apply(entry.op)
      if (entry.author.id !== this.me.id) {
        this.stale.add(voiceKey(entry.op.staffId, entry.op.voice))
        if (entry.op.type === 'insert') added.push(`${entry.op.id.lamport}@${entry.op.id.site}`)
      }
    }
    this.set({ voiceVersion: this.snapshot.voiceVersion + 1, ...(added.length ? { fadeIds: new Set([...this.snapshot.fadeIds, ...added]) } : {}) })
    if (added.length) window.setTimeout(() => this.set({ fadeIds: new Set() }), 1500)
    for (const listener of this.historyListeners) listener(fresh)
    this.scheduleEngraving()
    this.scheduleParts()
    if (this.stale.size) {
      window.clearTimeout(this.reconcileTimer)
      this.reconcileTimer = window.setTimeout(() => void this.reconcile(), 150)
    }
  }

  /** Remote edits are authoritative from the server: reload the voices they touched. */
  private async reconcile(): Promise<void> {
    const keys = [...this.stale]
    this.stale.clear()
    for (const key of keys) {
      const [staffId, voice] = key.split(':') as [string, string]
      await this.reloadVoice(staffId, Number(voice) as 1 | 2)
    }
    this.scheduleEngraving()
  }

  private onPart(part: Part): void {
    const known = this.snapshot.parts.find((p) => p.id === part.id)
    const parts = known ? this.snapshot.parts.map((p) => (p.id === part.id ? part : p)) : [...this.snapshot.parts, part]
    this.set({ parts })
    if (!known || known.status !== part.status || part.status === 'draft') {
      const copy = partNotice(part, known?.status)
      if (copy) this.notice('Parts', copy)
    }
  }

  private async onScore(score: ScoreSummary): Promise<void> {
    const before = this.snapshot.score
    this.grid = new MeasureGrid(score.timeSignatures)
    const added = score.staves.filter((s) => !before?.staves.some((b) => b.id === s.id))
    this.clock = Math.max(this.clock, score.lamport)
    this.set({ score, voiceVersion: this.snapshot.voiceVersion + 1 })
    if (added.length) await this.loadVoices(added.map((s) => s.id))
    this.scheduleEngraving(0)
    this.refreshParts()
  }

  private onTeam(collaborators: Collaborator[]): void {
    const before = this.snapshot.collaborators
    for (const next of collaborators) {
      const was = before.find((c) => c.id === next.id)
      if (was?.status === 'invited' && next.status === 'active') this.notice('Team', `${next.name} joined.`)
    }
    this.set({ collaborators })
  }

  private scheduleParts(): void {
    window.clearTimeout(this.partsTimer)
    this.partsTimer = window.setTimeout(() => this.refreshParts(), 400)
  }

  refreshParts(): void {
    api<{ parts: Part[] }>('GET', `/api/scores/${this.scoreId}/parts`).then((r) => this.set({ parts: r.parts }), () => undefined)
  }

  // ----- engraving -----

  scheduleEngraving(delay = 30): void {
    window.clearTimeout(this.engraveTimer)
    this.engraveTimer = window.setTimeout(() => void this.engrave(), delay)
  }

  private async fetchSystems(query: string): Promise<SystemSvg[]> {
    const systems: SystemSvg[] = []
    let cursor: string | null = null
    do {
      const page: EngravingPage = await api<EngravingPage>('GET', `/api/scores/${this.scoreId}/engraving?${query}${cursor ? `&cursor=${cursor}` : ''}`)
      systems.push(...page.systems)
      cursor = page.nextCursor
    } while (cursor)
    return systems
  }

  private async engrave(): Promise<void> {
    const run = ++this.engraveRun
    try {
      const systems = await this.fetchSystems('view=score&limit=16')
      if (run === this.engraveRun) this.set({ systems })
    } catch {
      // keeps the previous systems on screen; the next change engraves again
    }
  }

  async loadPartSystems(partId: string): Promise<void> {
    try {
      const systems = await this.fetchSystems(`view=part&partId=${partId}&limit=16`)
      const part = this.snapshot.parts.find((p) => p.id === partId)
      this.set({ partSystems: { ...this.snapshot.partSystems, [partId]: { systems, key: `${this.snapshot.score?.lamport}:${JSON.stringify(part?.layout)}` } } })
    } catch {
      // the part page keeps what it has
    }
  }

  // ----- operations -----

  nextStamp(): ElementId {
    this.clock += 1
    return { lamport: this.clock, site: this.me.id }
  }

  private readonly waiters = new Map<Operation, { resolve: () => void; reject: (error: ApiFailure) => void }>()

  /** Applies operations at once on this screen and queues them as a stamped batch; resolves once the server accepted them. */
  edit(build: (stamp: () => ElementId) => Operation[]): Promise<void> {
    const ops = build(() => this.nextStamp())
    for (const op of ops) this.voice(op.staffId, op.voice).apply(op)
    this.outbox.push(...ops)
    this.set({ voiceVersion: this.snapshot.voiceVersion + 1 })
    this.scheduleEngraving()
    this.scheduleFlush()
    return Promise.all(ops.map((op) => new Promise<void>((resolve, reject) => this.waiters.set(op, { resolve, reject })))).then(() => undefined)
  }

  private settle(op: Operation, error?: ApiFailure): void {
    const waiter = this.waiters.get(op)
    this.waiters.delete(op)
    if (error) waiter?.reject(error)
    else waiter?.resolve()
  }

  setText(staffId: string, voice: 1 | 2, target: ElementId, raw: string): Promise<void> {
    return this.edit((stamp) => [{ id: stamp(), type: 'set', staffId, voice, target, field: 'text', value: raw }])
  }

  addBank(bank: Bank): void {
    if (!this.snapshot.banks.some((b) => b.id === bank.id)) this.set({ banks: [bank, ...this.snapshot.banks] })
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.waitLeft > 0 || this.inflight) return
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = 0
      void this.flush()
    }, BATCH_DELAY_MS)
  }

  private queueText(): string {
    if (this.waitLeft > 0) return `Waiting ${this.waitLeft} s to send ${this.outbox.length} queued edits.`
    if (this.offline) return `Offline — ${this.outbox.length} edits queued. Retrying.`
    return this.snapshot.notices['Sync queue']
  }

  private async flush(): Promise<void> {
    if (this.inflight || this.waitLeft > 0 || this.outbox.length === 0) return
    this.inflight = true
    const batch = this.outbox.slice(0, 50)
    try {
      await api('POST', `/api/scores/${this.scoreId}/ops`, { ops: batch, seen: this.clock })
      this.outbox.splice(0, batch.length)
      for (const op of batch) this.settle(op)
      this.offline = false
      if (this.outbox.length === 0 && (this.waited || this.snapshot.notices['Sync queue'])) {
        this.waited = false
        this.notice('Sync queue', 'All queued edits sent.')
      }
      this.inflight = false
      if (this.outbox.length) void this.flush()
    } catch (error) {
      this.inflight = false
      if (error instanceof ApiFailure && error.status === 429) {
        this.waited = true
        this.waitLeft = error.body.retryAfterSeconds ?? error.retryAfter ?? 1
        this.notice('Sync queue', this.queueText())
        window.clearInterval(this.waitTimer)
        this.waitTimer = window.setInterval(() => {
          this.waitLeft -= 1
          if (this.waitLeft <= 0) {
            window.clearInterval(this.waitTimer)
            this.waitLeft = 0
            void this.flush()
          } else this.notice('Sync queue', this.queueText())
        }, 1000)
      } else if (error instanceof ApiFailure && error.status < 500 && error.status !== 401) {
        this.refuse(batch, error)
      } else {
        this.waited = true
        this.offline = true
        this.notice('Sync queue', this.queueText())
        this.flushTimer = window.setTimeout(() => {
          this.flushTimer = 0
          void this.flush()
        }, 2000)
      }
    }
  }

  /** A refused batch is dropped and the voices it touched are reloaded from the server. */
  private refuse(batch: Operation[], error: ApiFailure): void {
    this.outbox.splice(0, batch.length)
    for (const op of batch) this.settle(op, error)
    this.notice('Entry', `That edit was refused: ${error.detail}`)
    for (const key of new Set(batch.map((op) => voiceKey(op.staffId, op.voice)))) this.stale.add(key)
    void this.reconcile()
    if (this.outbox.length) void this.flush()
  }

  // ----- entry -----

  setEntry(patch: Partial<EntryState>): void {
    this.set({ entry: { ...this.snapshot.entry, ...patch } })
  }

  setSelection(selection: string[]): void {
    this.set({ selection })
  }

  // ----- playback -----

  async play(fromMeasure: number): Promise<void> {
    if (!this.playback) {
      this.playback = new Playback(
        {
          score: () => {
            const s = this.snapshot.score as ScoreSummary
            return { measureCount: s.measureCount, timeSignatures: s.timeSignatures, tempos: s.tempos, staves: s.staves.map((x) => ({ id: x.id, name: x.name })) }
          },
          events: (staffId) => [this.eventsOf(staffId, 1), this.eventsOf(staffId, 2)],
          banks: () => this.snapshot.banks,
          fetchBank: async (bank) => {
            const response = await fetch(`/api/scores/${this.scoreId}/banks/${bank.id}/content`, { headers: { Authorization: `Bearer ${seatToken() ?? ''}` } })
            if (!response.ok) throw new Error(String(response.status))
            return response.arrayBuffer()
          },
          ownStaffIds: this.me.role === 'player' ? this.me.staffIds : null,
        },
        {
          onPosition: (position) => this.set({ position }),
          onNotice: (text) => this.notice('Playback', text ?? ''),
          onState: (playing) => this.set(playing ? { playing } : { playing, position: null }),
        },
      )
    }
    await this.playback.start(fromMeasure)
  }

  stop(): void {
    this.playback?.stop()
  }

  togglePlay(): void {
    if (this.snapshot.playing) this.stop()
    else void this.play(this.caretMeasure())
  }

  private caretMeasure(): number {
    const { entry } = this.snapshot
    if (!entry.current) return 1
    const found = this.eventsOf(entry.staffId, entry.voice).find((e) => e.id.lamport === entry.current?.lamport && e.id.site === entry.current.site)
    return found?.pieces[found.pieces.length - 1]?.measure ?? found?.measure ?? 1
  }

  // ----- sections other tabs use -----

  fetchHistory = async (query: string): Promise<{ entries: HistoryEntry[]; nextCursor: string | null }> =>
    api('GET', `/api/scores/${this.scoreId}/history?${query}`)
}

function partNotice(part: Part, previous?: Part['status']): string {
  switch (part.status) {
    case 'engraving': return `Engraving ${part.name}…`
    case 'rendering': return `Rendering ${part.name} PDF…`
    case 'ready': return `${part.name} PDF ready.`
    case 'pdf_pending': return `${part.name} PDF pending: the renderer is unavailable. The preview pages are ready.`
    case 'draft': return part.lastError === 'storage_unavailable' && previous !== 'draft' ? `${part.name} could not be engraved: storage is unavailable. Try again later.` : ''
  }
}
