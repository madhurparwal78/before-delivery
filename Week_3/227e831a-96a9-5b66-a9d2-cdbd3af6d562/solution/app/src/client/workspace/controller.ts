import type { CarryMode, Category, Item, ListState, PackSheet, Profile, TripList } from '../../shared/api-types'
import { legalMoves } from '../../shared/list-state'
import { api, ApiError, NetworkError } from '../api'
import { cache } from '../cache'
import { holdForSignIn } from '../session-hold'
import { online } from '../status'
import { track } from '../writes'
import { displayList, lineMatches, type Desired, type Displayed } from './display'
import { enqueue, flushQueue, newOp, onSynced, replayQueue } from './sync-queue'

export type ChangeKind = 'pack-new' | 'unpack' | 'adjust'

/** The last change the hiker made, for the strata sequence. */
export interface ChangeInfo {
  seq: number
  kind: ChangeKind
  itemId: string
  category: Category
  itemName: string
  unitWeightGrams: number
  /** Where the item's chip starts when it is packed, in viewport coordinates. */
  rect: { x: number; y: number; width: number; height: number } | null
}

interface Messages {
  pack: string
  listState: string
  sheet: string
}

interface WorkspaceSnapshot {
  phase: 'loading' | 'ready' | 'missing'
  confirmed: TripList | null
  items: Item[]
  profile: Profile | null
  desired: ReadonlyMap<string, Desired>
  held: boolean
  messages: Messages
  sheet: PackSheet | null
  statePending: boolean
  printing: boolean
  focus: { key: string; seq: number } | null
  change: ChangeInfo | null
  displayed: Displayed | null
}

const STATE_COPY: Record<ListState, string> = {
  planning: 'List returned to planning.',
  packed: 'List marked packed.',
  walked: 'List marked walked.',
}

const CANCEL_COPY = 'Change not saved. Sign in to keep packing.'
const PRINT_DOWN = "Pack sheets can't be printed right now. Your list is unchanged; try again later."

type ControlKey = string

/** One open trip list: what the server confirmed, what the hiker wants it to become, and the writes between the two. */
export class WorkspaceController {
  private snapshot: WorkspaceSnapshot = {
    phase: 'loading', confirmed: null, items: [], profile: null, desired: new Map(), held: false,
    messages: { pack: '', listState: '', sheet: '' }, sheet: null, statePending: false, printing: false,
    focus: null, change: null, displayed: null,
  }
  private listeners = new Set<() => void>()
  private dirty: string[] = []
  private draining: Promise<void> | null = null
  private changeSeq = 0
  private focusSeq = 0
  private lastControl: ControlKey | null = null
  private heldRegistered = false
  private stopSync: (() => void) | null = null
  private disposed = false

  constructor(readonly listId: string) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): WorkspaceSnapshot => this.snapshot

  private publish(patch: Partial<WorkspaceSnapshot>): void {
    const next = { ...this.snapshot, ...patch }
    next.displayed = next.confirmed && next.profile
      ? displayList(next.confirmed, next.items, next.held ? new Map() : next.desired, next.profile)
      : null
    this.snapshot = next
    if (next.confirmed && next.displayed) {
      cache.lists.upsert({ id: next.confirmed.id, name: next.confirmed.name, state: next.confirmed.state, totals: next.displayed.totals })
    }
    for (const listener of this.listeners) listener()
  }

  private say(patch: Partial<Messages>): Partial<WorkspaceSnapshot> {
    return { messages: { ...this.snapshot.messages, ...patch } }
  }

  private focus(key: ControlKey): Partial<WorkspaceSnapshot> {
    return { focus: { key, seq: ++this.focusSeq } }
  }

  dispose(): void {
    this.disposed = true
    this.stopSync?.()
    this.listeners.clear()
  }

  // ---- loading -----------------------------------------------------------------------------

  async load(): Promise<void> {
    this.stopSync = onSynced(() => void this.afterSync())
    if (online.get()) await flushQueue()
    try {
      const [list, items, profile] = await Promise.all([api.list(this.listId), api.closet(), api.profile()])
      cache.list.set(list)
      cache.closet.set(items)
      cache.profile.set(profile)
      this.show(list, items, profile)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return this.publish({ phase: 'missing' })
      const list = cache.list.get(this.listId)
      const items = cache.closet.get()
      const profile = cache.profile.get()
      if (!list || !items || !profile) return this.publish({ phase: 'missing' })
      this.show(list, items, profile)
    }
    void this.refreshSheet()
  }

  private show(list: TripList, items: Item[], profile: Profile): void {
    const known = new Map(list.lines.map((line) => [line.itemId, { quantity: line.quantity, mode: line.mode }]))
    this.publish({ phase: 'ready', confirmed: list, items, profile, desired: replayQueue(this.listId, known) })
  }

  /** Reads the list and the available gear again and shows exactly what the server holds. */
  private async reread(): Promise<void> {
    const [list, items] = await Promise.all([api.list(this.listId), api.closet()])
    cache.list.set(list)
    cache.closet.set(items)
    this.publish({ confirmed: list, items })
  }

  private async afterSync(): Promise<void> {
    if (this.disposed) return
    this.publish({ desired: new Map() })
    await this.reread().catch(() => undefined)
    void this.refreshSheet()
  }

  async refreshSheet(): Promise<void> {
    try {
      const [newest] = await api.sheets(this.listId)
      this.publish({ sheet: newest ?? null })
    } catch {
      // The sheet list is only a convenience; the workspace keeps what it already shows.
    }
  }

  // ---- inputs ------------------------------------------------------------------------------

  private displayed(): Displayed | null {
    return this.snapshot.displayed
  }

  private editable(): boolean {
    return this.snapshot.phase === 'ready' && this.snapshot.confirmed?.state === 'planning' && !this.snapshot.held
  }

  /** The control to focus after an unpack: the Pack button, or the line that took the removed line's place. */
  private afterUnpack(itemId: string): ControlKey {
    const item = this.snapshot.items.find((candidate) => candidate.id === itemId)
    if (item && item.unitsOwned > 0) return `pack:${itemId}`
    const lines = this.displayed()?.lines ?? []
    const index = lines.findIndex((line) => line.itemId === itemId)
    const neighbour = lines[index + 1] ?? lines[index - 1]
    return neighbour ? `unpack:${neighbour.itemId}` : 'region:list'
  }

  pack(itemId: string, rect: ChangeInfo['rect']): void {
    const item = this.snapshot.items.find((candidate) => candidate.id === itemId)
    if (!this.editable() || !item || item.unitsOwned === 0) return
    const line = this.displayed()?.lines.find((candidate) => candidate.itemId === itemId)
    if (line) {
      this.apply(itemId, { exists: true, quantity: Math.min(line.quantity + 1, item.unitsOwned), mode: line.mode }, `qty:${itemId}`, 'adjust', rect)
    } else {
      this.apply(itemId, { exists: true, quantity: 1, mode: 'base' }, `qty:${itemId}`, 'pack-new', rect)
    }
  }

  setQuantity(itemId: string, quantity: number, control: ControlKey): void {
    const line = this.displayed()?.lines.find((candidate) => candidate.itemId === itemId)
    const item = this.snapshot.items.find((candidate) => candidate.id === itemId)
    if (!this.editable() || !line || !item) return
    const next = Math.min(Math.max(quantity, 1), item.unitsOwned)
    if (next === line.quantity) return
    this.apply(itemId, { exists: true, quantity: next, mode: line.mode }, control, 'adjust', null)
  }

  setMode(itemId: string, mode: CarryMode, control: ControlKey): void {
    const line = this.displayed()?.lines.find((candidate) => candidate.itemId === itemId)
    if (!this.editable() || !line || line.mode === mode) return
    this.apply(itemId, { exists: true, quantity: line.quantity, mode }, control, 'adjust', null)
  }

  unpack(itemId: string): void {
    const line = this.displayed()?.lines.find((candidate) => candidate.itemId === itemId)
    if (!this.editable() || !line) return
    this.apply(itemId, { exists: false, quantity: line.quantity, mode: line.mode }, this.afterUnpack(itemId), 'unpack', null)
  }

  /** One input: shown at once, announced, then sent (online) or kept on the device (offline), in input order. */
  private apply(itemId: string, target: Desired, focusKey: ControlKey, kind: ChangeKind, rect: ChangeInfo['rect']): void {
    const before = this.displayed()?.lines.find((candidate) => candidate.itemId === itemId)
    const item = this.snapshot.items.find((candidate) => candidate.id === itemId)
    const desired = new Map(this.snapshot.desired)
    desired.set(itemId, target)
    this.lastControl = focusKey
    this.publish({ desired, change: { seq: ++this.changeSeq, kind, itemId, category: item?.category ?? 'Shelter', itemName: item?.name ?? '', unitWeightGrams: item?.weightGrams ?? 0, rect: rect ?? null } })
    const { totals } = this.snapshot.displayed ?? {}
    this.publish({
      ...this.say({ pack: totals ? `Base weight ${totals.display.base}. ${totals.display.delta}.` : '' }),
      ...this.focus(focusKey),
    })
    if (!online.get()) this.enqueueOffline(itemId, before ? { quantity: before.quantity, mode: before.mode } : null, target)
    else this.schedule(itemId)
  }

  private enqueueOffline(itemId: string, before: { quantity: number; mode: CarryMode } | null, after: Desired): void {
    const item = this.snapshot.items.find((candidate) => candidate.id === itemId)
    const names = { itemName: item?.name ?? '', listName: this.snapshot.confirmed?.name ?? '' }
    const add = (op: ReturnType<typeof newOp>) => enqueue({ op, ...names })
    if (!before && after.exists) add(newOp(this.listId, itemId, { type: 'pack' }))
    else if (before && !after.exists) add(newOp(this.listId, itemId, { type: 'unpack' }))
    else if (before) {
      if (before.quantity !== after.quantity) add(newOp(this.listId, itemId, { type: 'set_quantity', quantity: after.quantity, fromQuantity: before.quantity }))
      if (before.mode !== after.mode) add(newOp(this.listId, itemId, { type: 'set_mode', mode: after.mode }))
    }
  }

  // ---- writes ------------------------------------------------------------------------------

  private schedule(itemId: string): void {
    if (!this.dirty.includes(itemId)) this.dirty.push(itemId)
    if (!this.draining) this.draining = track(this.drain())
  }

  /** Settles when every write the hiker has asked for has been answered. */
  async idle(): Promise<void> {
    while (this.draining) await this.draining
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty.length > 0 && !this.snapshot.held) {
        const itemId = this.dirty.shift() ?? ''
        await this.settleItem(itemId)
      }
    } finally {
      this.draining = null
    }
    if (!this.snapshot.held && this.dirty.length === 0) {
      void this.refreshSheet()
      this.focusAfterResume()
    }
  }

  private async settleItem(itemId: string): Promise<void> {
    for (;;) {
      const want = this.snapshot.desired.get(itemId)
      const confirmed = this.snapshot.confirmed
      if (!want || !confirmed) return
      const have = confirmed.lines.find((line) => line.itemId === itemId)
      if (lineMatches(want, have)) return this.clearTarget(itemId)
      try {
        let list: TripList
        if (want.exists && !have) list = await api.addLine(this.listId, itemId)
        else if (!want.exists && have) list = await api.removeLine(this.listId, have.id)
        else if (have) list = await api.editLine(this.listId, have.id, { ...(have.quantity !== want.quantity ? { quantity: want.quantity } : {}), ...(have.mode !== want.mode ? { mode: want.mode } : {}) })
        else return
        cache.list.set(list)
        this.publish({ confirmed: list })
      } catch (error) {
        if (await this.refused(error, itemId)) return
      }
    }
  }

  private clearTarget(itemId: string): void {
    const desired = new Map(this.snapshot.desired)
    desired.delete(itemId)
    this.publish({ desired })
  }

  /** Handles a refused write; true means this item has nothing more to send. */
  private async refused(error: unknown, itemId: string): Promise<boolean> {
    const item = this.snapshot.items.find((candidate) => candidate.id === itemId)
    if (error instanceof NetworkError) {
      if (!online.get()) {
        this.spill(itemId)
      } else {
        this.clearTarget(itemId)
        this.publish(this.say({ pack: "Couldn't reach Skinout. Your change was not saved." }))
        await this.reread().catch(() => undefined)
      }
      return true
    }
    if (!(error instanceof ApiError)) throw error
    if (error.status === 401) {
      this.dirty.unshift(itemId)
      this.hold()
      return true
    }
    if (error.code === 'line_exists' || error.code === 'line_not_found') {
      await this.reread()
      return false
    }
    this.clearTarget(itemId)
    await this.reread().catch(() => undefined)
    const state = this.snapshot.confirmed
    if (error.code === 'item_retired') {
      this.publish({ ...this.say({ pack: `${item?.name ?? 'That item'} is no longer in your closet.` }), ...this.focus('region:closet') })
    } else if (error.code === 'list_not_editable' && state) {
      this.dirty = []
      this.publish({
        desired: new Map(),
        ...this.say({ pack: `${state.name} is ${state.state} on another device and can't be edited.` }),
        ...this.focus('heading'),
      })
    } else {
      this.publish(this.say({ pack: error.fields.quantity ?? error.message }))
    }
    return true
  }

  /** The connection dropped mid-write: what was not yet confirmed goes to the device's queue as ops. */
  private spill(itemId: string): void {
    const want = this.snapshot.desired.get(itemId)
    const have = this.snapshot.confirmed?.lines.find((line) => line.itemId === itemId)
    if (!want) return
    this.enqueueOffline(itemId, have ? { quantity: have.quantity, mode: have.mode } : null, want)
  }

  // ---- session ended -----------------------------------------------------------------------

  private hold(): void {
    this.publish({ held: true })
    if (this.heldRegistered) return
    this.heldRegistered = true
    holdForSignIn({
      resume: async () => {
        this.heldRegistered = false
        this.publish({ held: false })
        if (this.dirty.length === 0) this.focusAfterResume()
        else this.draining ??= track(this.drain())
        await this.idle()
      },
      cancel: () => {
        this.heldRegistered = false
        this.dirty = []
        this.publish({ held: false, desired: new Map(), ...this.say({ pack: CANCEL_COPY }), ...this.focus(this.lastControl ?? 'heading') })
      },
    })
  }

  private focusAfterResume(): void {
    if (!this.lastControl || this.snapshot.held) return
    const key = this.lastControl
    this.lastControl = null
    this.publish(this.focus(key))
  }

  // ---- list state, sheets ------------------------------------------------------------------

  async changeState(to: ListState, control: ControlKey): Promise<void> {
    const state = this.snapshot.confirmed?.state
    if (this.snapshot.statePending || !state || !legalMoves(state).includes(to)) return
    this.publish({ statePending: true })
    await this.idle()
    try {
      const list = await api.changeState(this.listId, to)
      cache.list.set(list)
      this.publish({ confirmed: list, desired: new Map(), statePending: false, ...this.say({ listState: STATE_COPY[to] }), ...this.focus('heading') })
      void this.refreshSheet()
    } catch (error) {
      if (!(error instanceof ApiError)) {
        this.publish({ statePending: false })
        if (error instanceof NetworkError) return this.publish(this.say({ listState: "Couldn't reach Skinout. The list state did not change." }))
        throw error
      }
      if (error.status === 401) {
        this.publish({ statePending: false })
        holdForSignIn({
          resume: () => this.changeState(to, control),
          cancel: () => this.publish({ ...this.say({ pack: CANCEL_COPY }), ...this.focus(control) }),
        })
        return
      }
      await this.reread().catch(() => undefined)
      this.publish({ statePending: false, ...this.say({ listState: error.message }), ...this.focus('heading') })
      void this.refreshSheet()
    }
  }

  async print(): Promise<void> {
    if (this.snapshot.printing) return
    this.publish({ printing: true, ...this.say({ sheet: 'Rendering pack sheet...' }) })
    await this.idle()
    try {
      const sheet = await api.printSheet(this.listId)
      this.publish({ printing: false, sheet, ...this.say({ sheet: 'Pack sheet ready.' }) })
    } catch (error) {
      if (!(error instanceof ApiError) && !(error instanceof NetworkError)) throw error
      this.publish({ printing: false, ...this.say({ sheet: PRINT_DOWN }) })
    }
  }
}
