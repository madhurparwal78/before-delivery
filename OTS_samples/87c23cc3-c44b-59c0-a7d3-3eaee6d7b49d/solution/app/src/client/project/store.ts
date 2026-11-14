import { DEFAULT_LIMITS, type ColorName, type Layout, type Person, type ProjectJson, type Role, type ServerMessage, type UserJson } from '../../shared/domain.ts'
import { COPY } from '../../shared/copy.ts'
import { reconcileLayout } from '../../shared/layout.ts'
import { parseMortise, parseTolerant, type ColumnRef, type Model, type MortiseError } from '../../shared/mortise.ts'
import { insertLinkLine } from '../../shared/canonical.ts'
import { mergeEdit } from '../../shared/units.ts'
import { api, ApiFailure } from '../api.ts'
import type { Region } from '../announce.tsx'
import { reducedMotion } from '../motion.ts'

type Source = { kind: 'project'; id: string } | { kind: 'link'; token: string } | { kind: 'sample'; text: string }
type SaveState = 'saved' | 'saving' | 'retrying'
export type LayoutCause = 'load' | 'move' | 'arrange' | 'restore' | 'remote'

export interface CaretRequest {
  stamp: number
  start: number
  end: number
  focus: boolean
}

export interface Snapshot {
  phase: 'loading' | 'ready' | 'missing'
  name: string
  role: Role | null
  /** Whether the server currently lets this person change the project. */
  canEdit: boolean
  /** True while a written-back link line is being typed in: the editor is read-only. */
  typing: boolean
  text: string
  errors: MortiseError[]
  /** The last parse without errors: what the diagram shows. */
  model: Model | null
  layout: Layout
  layoutCause: { stamp: number; cause: LayoutCause }
  saveState: SaveState
  people: Person[]
  linkViewers: number
  revision: number
  caret: CaretRequest | null
}

interface StoreHooks {
  say: (region: Region, text: string) => void
  raise: (text: string) => void
  parseDelayMs: number
  self: UserJson | null | undefined
}

const CHAR_MS = 35
const RETRY_MS = 3000
const EMPTY_LAYOUT: Layout = { entities: {}, groups: {} }

const toLf = (text: string): string => text.replace(/\r\n/g, '\n')

function firstFieldMessage(failure: ApiFailure): string {
  const fields = failure.body.fields
  return fields ? (Object.values(fields)[0] ?? failure.body.message) : failure.body.message
}

/** The one place that holds a project on the screen: text, layout, parse, live channel and saving. */
export class ProjectStore {
  private snap: Snapshot
  private readonly listeners = new Set<() => void>()
  private base = { revision: 0, text: '' }
  private serverLayout: Layout = EMPTY_LAYOUT
  private eol = '\n'
  private inflight: string | null = null
  private quiet: number | null = null
  private retryTimer: number | null = null
  private pendingRemote: { revision: number; text: string } | null = null
  private pendingMoves = 0
  private socket: WebSocket | null = null
  private pingTimer: number | null = null
  private reconnectTimer: number | null = null
  private disposed = false
  private lostAccess = false
  private stamp = 0
  private rejectedText: string | null = null
  private sending: Promise<void> | null = null
  /** True from the moment a write-back is requested until its line has been typed in. */
  private writing = false
  private opened = false
  private layoutQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly source: Source,
    public hooks: StoreHooks,
  ) {
    const sample = source.kind === 'sample'
    this.snap = {
      phase: sample ? 'ready' : 'loading',
      name: '',
      role: sample ? 'owner' : null,
      canEdit: sample,
      typing: false,
      text: sample ? source.text : '',
      errors: [],
      model: null,
      layout: EMPTY_LAYOUT,
      layoutCause: { stamp: 0, cause: 'load' },
      saveState: 'saved',
      people: [],
      linkViewers: 0,
      revision: 0,
      caret: null,
    }
    if (sample) this.parseNow()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): Snapshot => this.snap

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch }
    for (const listener of this.listeners) listener()
  }

  private get remote(): boolean {
    return this.source.kind !== 'sample'
  }

  private get projectPath(): string {
    return `/api/projects/${(this.source as { id: string }).id}`
  }

  /* ----------------------------------------------------------- lifecycle */

  async start(): Promise<void> {
    if (this.source.kind === 'sample') return
    try {
      const project =
        this.source.kind === 'project'
          ? await api<ProjectJson>('GET', this.projectPath)
          : await api<ProjectJson>('GET', `/api/shared/${this.source.token}`)
      if (this.disposed) return
      this.adoptLoaded(project)
      this.connect()
    } catch {
      if (!this.disposed) this.set({ phase: 'missing' })
    }
  }

  private adoptLoaded(project: ProjectJson): void {
    this.eol = project.text.includes('\r\n') ? '\r\n' : '\n'
    const text = toLf(project.text)
    this.base = { revision: project.revision, text }
    this.serverLayout = project.layout
    this.set({
      phase: 'ready',
      name: project.name,
      role: project.role,
      canEdit: project.role !== 'viewer',
      text,
      revision: project.revision,
    })
    this.parseNow('load')
  }

  dispose(): void {
    this.disposed = true
    for (const timer of [this.quiet, this.retryTimer, this.pingTimer, this.reconnectTimer]) if (timer !== null) window.clearTimeout(timer)
    this.socket?.close()
  }

  /* ---------------------------------------------------------- live channel */

  private connect(): void {
    if (this.disposed || this.lostAccess) return
    const path = this.source.kind === 'project' ? `${this.projectPath}/live` : `/api/shared/${(this.source as { token: string }).token}/live`
    const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${path}`
    const socket = new WebSocket(url)
    this.socket = socket
    socket.onopen = () => {
      this.opened = true
    }
    socket.onmessage = (event) => this.onMessage(JSON.parse(String(event.data)) as ServerMessage)
    socket.onclose = () => {
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
      if (this.disposed || this.lostAccess) return
      if (!this.opened) void this.checkAccess()
      this.opened = false
      this.reconnectTimer = window.setTimeout(() => this.connect(), 2000)
    }
  }

  private onMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'hello': {
        if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
        const every = Math.max(250, (message.presenceTimeoutSeconds * 1000) / 3)
        this.pingTimer = window.setInterval(() => {
          if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'ping' }))
        }, every)
        this.onRevision(message.revision, message.text)
        this.applyAccess(message.access)
        break
      }
      case 'revision':
        this.onRevision(message.revision, message.text)
        break
      case 'layout':
        if (message.by.userId !== this.hooks.self?.id) {
          this.serverLayout = message.layout
          this.refreshLayout('remote')
        }
        break
      case 'presence':
        this.set({ people: message.people, linkViewers: message.linkViewers })
        break
      case 'access':
        this.onAccess(message)
        break
    }
  }

  private applyAccess(access: Role): void {
    if (this.source.kind !== 'project') return
    if (this.snap.canEdit && access === 'viewer') this.hooks.raise('Your access changed to view only.')
    this.set({ canEdit: access !== 'viewer' })
  }

  /** A channel that never opened was refused: when the project or link is gone, say so. */
  private async checkAccess(): Promise<void> {
    try {
      await api(
        'GET',
        this.source.kind === 'project' ? this.projectPath : `/api/shared/${(this.source as { token: string }).token}`,
      )
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) {
        this.onAccess({ type: 'access', access: 'none', reason: this.source.kind === 'project' ? 'removed' : 'revoked' })
      }
    }
  }

  private onAccess(message: Extract<ServerMessage, { type: 'access' }>): void {
    if (message.access === 'viewer') {
      this.hooks.raise('Your access changed to view only.')
      this.set({ canEdit: false })
    } else if (message.access === 'editor') {
      this.hooks.raise('You can edit this project again.')
      this.set({ canEdit: true })
    } else {
      const copy = {
        removed: 'You no longer have access to this project.',
        revoked: 'The owner turned off this link.',
        rotated: 'The owner replaced this link with a new one.',
        expired: 'This link has expired.',
        role_changed: 'Your access changed to view only.',
      }[message.reason]
      this.hooks.raise(copy)
      this.lostAccess = true
      this.set({ canEdit: false })
    }
  }

  /* ----------------------------------------------------------- text and parse */

  /** The person typed or an action replaced the whole text. */
  typed(text: string): void {
    if (this.snap.typing || !this.snap.canEdit) return
    this.set({ text, saveState: this.remote ? 'saving' : 'saved' })
    if (this.quiet !== null) window.clearTimeout(this.quiet)
    this.quiet = window.setTimeout(() => this.settle(), this.hooks.parseDelayMs)
  }

  /** Replaces the text and parses it at once, without waiting for quiet typing (the sample editor). */
  replaceNow(text: string): void {
    this.set({ text })
    this.parseNow()
  }

  private settle(): void {
    this.quiet = null
    this.parseNow()
    this.trySend()
  }

  private parseNow(cause: LayoutCause = 'remote'): void {
    const { model, errors } = parseMortise(this.snap.text, DEFAULT_LIMITS)
    const valid = errors.length === 0
    this.snap = { ...this.snap, errors, model: valid ? model : (this.snap.model ?? parseTolerant(this.snap.text, DEFAULT_LIMITS)) }
    this.say(errors)
    this.refreshLayout(valid ? cause : null)
  }

  private say(errors: MortiseError[]): void {
    const first = errors[0]
    const copy = !first
      ? 'No errors.'
      : `${errors.length === 1 ? '1 error.' : `${errors.length} errors.`} First error at line ${first.line}, column ${first.column}.`
    this.hooks.say('editor', copy)
  }

  /** The layout to draw: the server layout with the next free cells filled in for entities it does not know yet. */
  private refreshLayout(cause: LayoutCause | null): void {
    const model = this.snap.model
    const layout = model ? reconcileLayout(this.serverLayout, model) : this.serverLayout
    this.set({
      layout,
      layoutCause: cause === null ? this.snap.layoutCause : { stamp: ++this.stamp, cause },
    })
  }

  /* --------------------------------------------------------------- saving */

  private trySend(): void {
    const text = this.snap.text
    if (!this.remote || this.inflight !== null || this.snap.typing || !this.snap.canEdit) return
    if (text === this.base.text || text === this.rejectedText) {
      this.set({ saveState: 'saved' })
      return
    }
    this.inflight = text
    this.set({ saveState: 'saving' })
    const body = { baseRevision: this.base.revision, text: this.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text }
    this.sending = api<{ revision: number; text: string; merged: boolean }>('POST', `${this.projectPath}/edits`, body).then(
      (reply) => {
        this.inflight = null
        this.accept(text, reply.revision, toLf(reply.text))
      },
      (error: unknown) => {
        this.inflight = null
        this.refused(text, error)
      },
    )
  }

  private accept(sent: string, revision: number, serverText: string): void {
    this.base = { revision, text: serverText }
    this.rejectedText = null
    const local = this.snap.text
    let next = local
    if (local === sent) next = serverText
    else if (serverText !== sent) {
      const merged = mergeEdit(sent, local, serverText)
      next = merged.conflict === null ? merged.text : serverText
    }
    this.set({ text: next, revision })
    this.parseNow()
    const remote = this.pendingRemote
    this.pendingRemote = null
    if (remote && remote.revision > this.base.revision) this.onRevision(remote.revision, remote.text)
    if (this.snap.text !== this.base.text) {
      if (this.quiet === null) this.quiet = window.setTimeout(() => this.settle(), this.hooks.parseDelayMs)
    } else this.set({ saveState: 'saved' })
  }

  private refused(sent: string, error: unknown): void {
    if (!(error instanceof ApiFailure) || error.transient) {
      this.set({ saveState: 'retrying' })
      this.retryTimer = window.setTimeout(() => this.trySend(), RETRY_MS)
      return
    }
    const conflict = error.body.conflicts?.[0]
    if (error.status === 409 && conflict && error.body.text !== undefined && error.body.revision !== undefined) {
      this.hooks.raise(`${conflict.by} changed ${conflict.unit} first. Your edit was not saved and the text now shows the latest version.`)
      this.base = { revision: error.body.revision, text: toLf(error.body.text) }
      this.set({ text: this.base.text, revision: error.body.revision, saveState: 'saved' })
      this.parseNow()
      return
    }
    if (error.status === 413) {
      this.hooks.raise(error.body.message)
      this.rejectedText = sent
      this.set({ saveState: 'saved' })
      return
    }
    void this.reload().then(() => this.set({ saveState: 'saved' }))
  }

  /** Waits until everything typed so far has been sent and accepted. */
  async flush(): Promise<void> {
    if (!this.remote) return
    if (this.quiet !== null) {
      window.clearTimeout(this.quiet)
      this.settle()
    }
    while (this.sending) {
      const pending = this.sending
      await pending
      if (this.sending === pending) this.sending = null
      if (this.snap.text !== this.base.text) {
        if (this.quiet !== null) {
          window.clearTimeout(this.quiet)
          this.quiet = null
          this.parseNow()
        }
        this.trySend()
      }
    }
  }

  private onRevision(revision: number, rawText: string): void {
    if (revision <= this.base.revision) return
    if (this.inflight !== null || this.snap.typing || this.writing) {
      this.pendingRemote = { revision, text: rawText }
      return
    }
    const text = toLf(rawText)
    const local = this.snap.text
    if (local === this.base.text) {
      this.base = { revision, text }
      this.set({ text, revision })
      this.parseNow()
      return
    }
    const merged = mergeEdit(this.base.text, local, text)
    if (merged.conflict === null) {
      this.base = { revision, text }
      this.set({ text: merged.text, revision })
      this.parseNow()
    }
  }

  /** Fetches the project and adopts it, for example after an import. */
  async reload(): Promise<void> {
    if (this.source.kind !== 'project') return
    const project = await api<ProjectJson>('GET', this.projectPath)
    if (project.revision >= this.base.revision) {
      this.base = { revision: project.revision, text: toLf(project.text) }
      this.serverLayout = project.layout
      this.set({ text: this.base.text, revision: project.revision })
      this.parseNow('remote')
    }
  }

  /** Adopts a project answer, for example the one a restore returns. */
  adopt(project: ProjectJson): void {
    this.base = { revision: project.revision, text: toLf(project.text) }
    this.serverLayout = project.layout
    this.set({ text: this.base.text, revision: project.revision })
    this.parseNow('restore')
  }

  /** The revision the text on the server is at. */
  get revision(): number {
    return this.base.revision
  }

  requestCaret(start: number, end: number, focus: boolean): void {
    this.set({ caret: { stamp: ++this.stamp, start, end, focus } })
  }

  /* ---------------------------------------------------------------- layout */

  private queueLayout(task: () => Promise<void>): void {
    this.layoutQueue = this.layoutQueue.then(task, task)
  }

  moveEntity(name: string, x: number, y: number): void {
    const known = this.snap.layout.entities[name]
    if (!known) return
    this.serverLayout = { ...this.serverLayout, entities: { ...this.serverLayout.entities, [name]: { ...known, x, y } } }
    this.refreshLayout('move')
    if (!this.remote) return
    this.pendingMoves++
    this.queueLayout(async () => {
      try {
        const answer = await api<{ layout: Layout }>('PATCH', `${this.projectPath}/layout`, { entities: { [name]: { x, y } } })
        if (this.pendingMoves === 1) {
          this.serverLayout = answer.layout
          this.refreshLayout('move')
        }
      } catch {
        await this.reload().catch(() => undefined)
      } finally {
        this.pendingMoves--
      }
    })
  }

  setColors(names: string[], color: ColorName): void {
    const entities = { ...this.serverLayout.entities }
    for (const name of names) {
      const known = this.snap.layout.entities[name]
      if (known) entities[name] = { ...known, color }
    }
    this.serverLayout = { ...this.serverLayout, entities }
    this.refreshLayout('move')
    const last = names[names.length - 1]
    if (last) this.hooks.say('diagram', `${last} is now ${color}.`)
    if (!this.remote) return
    this.queueLayout(async () => {
      await api('PATCH', `${this.projectPath}/layout`, { entities: Object.fromEntries(names.map((name) => [name, { color }])) }).catch(() => this.reload())
    })
  }

  async arrange(): Promise<void> {
    if (!this.remote) return
    const answer = await api<{ layout: Layout }>('POST', `${this.projectPath}/layout/arrange`)
    this.serverLayout = answer.layout
    this.refreshLayout('arrange')
    this.hooks.say('diagram', `Arranged ${Object.keys(answer.layout.entities).length} entities.`)
  }

  /* ------------------------------------------------------- writes on the text */

  /** Draws a link: the server writes one line into the text, which is then typed in character by character. */
  async drawLink(from: ColumnRef, to: ColumnRef): Promise<void> {
    if (from.entity === to.entity && from.column === to.column) {
      this.hooks.say('diagram', COPY.sameColumn)
      return
    }
    await this.flush()
    this.writing = true
    let written: { revision: number; text: string }
    try {
      written = this.remote
        ? await api<{ revision: number; text: string }>('POST', `${this.projectPath}/links`, {
            baseRevision: this.base.revision,
            from: `${from.entity}.${from.column}`,
            to: `${to.entity}.${to.column}`,
          })
        : this.writeLinkLocally(from, to)
    } catch (error) {
      this.writing = false
      const remote = this.pendingRemote
      this.pendingRemote = null
      if (remote) this.onRevision(remote.revision, remote.text)
      if (error instanceof ApiFailure) this.hooks.say('diagram', error.status === 422 ? firstFieldMessage(error) : error.body.message)
      return
    }
    await this.typeIn(written.revision, toLf(written.text))
    this.hooks.say('diagram', `Linked ${from.entity}.${from.column} to ${to.entity}.${to.column}, many to one.`)
  }

  private writeLinkLocally(from: ColumnRef, to: ColumnRef): { revision: number; text: string } {
    const { model, errors } = parseMortise(this.snap.text, DEFAULT_LIMITS)
    if (errors.length) throw new ApiFailure(409, { error: 'schema_has_errors', message: COPY.fixErrorsFirst })
    return { revision: this.base.revision + 1, text: insertLinkLine(this.snap.text, model, from, to).text }
  }

  private async typeIn(revision: number, serverText: string): Promise<void> {
    const before = this.snap.text
    this.base = { revision, text: serverText }
    this.rejectedText = null
    let prefix = 0
    while (prefix < before.length && prefix < serverText.length && before.charAt(prefix) === serverText.charAt(prefix)) prefix++
    let suffix = 0
    while (suffix < before.length - prefix && suffix < serverText.length - prefix && before.charAt(before.length - 1 - suffix) === serverText.charAt(serverText.length - 1 - suffix)) suffix++
    const inserted = serverText.slice(prefix, serverText.length - suffix)
    const finish = (): void => {
      const lineEnd = prefix + inserted.replace(/\n$/, '').length
      this.writing = false
      this.set({ text: serverText, typing: false, revision })
      this.parseNow()
      this.requestCaret(inserted.startsWith('\n') ? prefix + inserted.length : lineEnd, inserted.startsWith('\n') ? prefix + inserted.length : lineEnd, true)
      const remote = this.pendingRemote
      this.pendingRemote = null
      if (remote) this.onRevision(remote.revision, remote.text)
    }
    if (reducedMotion()) {
      finish()
      return
    }
    this.set({ typing: true })
    for (let typed = 1; typed <= inserted.length; typed++) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, CHAR_MS))
      this.set({ text: before.slice(0, prefix) + inserted.slice(0, typed) + before.slice(prefix) })
    }
    finish()
  }

  async createGroup(name: string, entities: string[], color: ColorName): Promise<void> {
    await this.flush()
    const answer = await api<{ revision: number; text: string; layout: Layout }>('POST', `${this.projectPath}/groups`, {
      baseRevision: this.base.revision,
      name,
      entities,
      color,
    })
    this.adoptWrite(answer)
    const ordered = this.snap.model?.entities.map((entity) => entity.name).filter((entity) => entities.includes(entity)) ?? entities
    this.hooks.say('diagram', `Grouped ${ordered.join(', ')} as "${name}".`)
  }

  async removeGroup(name: string): Promise<void> {
    await this.flush()
    const answer = await api<{ revision: number; text: string; layout: Layout }>(
      'DELETE',
      `${this.projectPath}/groups/${encodeURIComponent(name)}?baseRevision=${this.base.revision}`,
    )
    this.adoptWrite(answer)
    this.hooks.say('diagram', `Removed group "${name}".`)
  }

  async renameEntity(from: string, to: string): Promise<void> {
    await this.flush()
    const answer = await api<{ revision: number; text: string; layout: Layout }>('POST', `${this.projectPath}/entities/rename`, {
      baseRevision: this.base.revision,
      from,
      to,
    })
    this.adoptWrite(answer)
    this.hooks.say('diagram', `Renamed ${from} to ${to}.`)
  }

  private adoptWrite(answer: { revision: number; text: string; layout: Layout }): void {
    this.base = { revision: answer.revision, text: toLf(answer.text) }
    this.serverLayout = answer.layout
    this.set({ text: this.base.text, revision: answer.revision })
    this.parseNow('remote')
  }
}
