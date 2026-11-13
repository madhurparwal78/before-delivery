// Keyboard note entry: every key and Note pad button does one thing here, announced in the Entry region.

import {
  DURATIONS, durationWord, formatBeat, middleLine, moveOctave, moveSemitone, nearestOctave, pitchText, plainDurationWord, respell,
  type DurationName, type Step,
} from '../shared/music.js'
import { DYNAMICS, type ElementId, type NewEvent, type PlacedEvent } from '../shared/voice.js'
import type { Session } from './session.js'

const KEY_DURATION: Record<string, DurationName> = { '7': 'whole', '6': 'half', '5': 'quarter', '4': 'eighth', '3': '16th', '2': '32nd' }
const CYCLE = [null, ...DYNAMICS.slice(0, 6)] as const

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

function entryCopy(event: PlacedEvent): string {
  const words = durationWord(event.duration, event.dots)
  const place = `measure ${event.measure}, beat ${formatBeat(event.beat)}.`
  const head = event.kind === 'note' && event.pitch ? `${pitchText(event.pitch)} ${words}, ${place}` : `${capital(words)} rest, ${place}`
  const last = event.pieces[event.pieces.length - 1]
  return event.pieces.length > 1 && last ? `${head} Tied across the barline into measure ${last.measure}.` : head
}

const sameId = (a: ElementId | null, b: ElementId): boolean => !!a && a.lamport === b.lamport && a.site === b.site

export class Editor {
  constructor(
    private readonly session: Session,
    readonly openText: () => void,
  ) {}

  private get entry() {
    return this.session.getSnapshot().entry
  }

  private events(): PlacedEvent[] {
    return this.session.eventsOf(this.entry.staffId, this.entry.voice)
  }

  private caretIndex(events: PlacedEvent[]): number {
    const { current } = this.entry
    if (!current) return -1
    const at = events.findIndex((e) => sameId(current, e.id))
    return at === -1 ? events.length - 1 : at
  }

  currentEvent(): PlacedEvent | null {
    const events = this.events()
    return events[this.caretIndex(events)] ?? null
  }

  /** Queues an edit; a refusal is announced by the session, so the confirmation is not awaited here. */
  private send(build: Parameters<Session['edit']>[0]): void {
    this.session.edit(build).catch(() => undefined)
  }

  private say(text: string): void {
    this.session.notice('Entry', text)
  }

  private staffName(): string {
    return this.session.getSnapshot().score?.staves.find((s) => s.id === this.entry.staffId)?.name ?? ''
  }

  private announceEntering(): void {
    this.say(`Entering on ${this.staffName()}, voice ${this.entry.voice}.`)
  }

  /** The first note at or before the caret, skipping rests. */
  private referenceNote(events: PlacedEvent[], at: number): { step: Step; octave: number } {
    for (let i = at; i >= 0; i--) {
      const e = events[i] as PlacedEvent
      if (e.kind === 'note' && e.pitch) return { step: e.pitch.step, octave: e.pitch.octave }
    }
    const staff = this.session.getSnapshot().score?.staves.find((s) => s.id === this.entry.staffId)
    return middleLine(staff?.clef ?? 'treble')
  }

  private insert(event: NewEvent): void {
    const { staffId, voice } = this.entry
    const events = this.events()
    const after = events[this.caretIndex(events)]?.id ?? null
    let created: ElementId | null = null
    this.send((stamp) => {
      created = stamp()
      return [{ id: created, type: 'insert', staffId, voice, after, event }]
    })
    const id = created as ElementId | null
    this.session.setEntry({ current: id })
    const placed = this.events().find((e) => sameId(id, e.id))
    if (placed) this.say(entryCopy(placed))
  }

  enterNote(step: Step): void {
    const events = this.events()
    const reference = this.referenceNote(events, this.caretIndex(events))
    this.insert({
      kind: 'note', pitch: { step, alter: 0, octave: nearestOctave(step, reference) }, duration: this.entry.duration, dots: this.entry.dotted ? 1 : 0,
    })
  }

  enterRest(): void {
    this.insert({ kind: 'rest', duration: this.entry.duration, dots: this.entry.dotted ? 1 : 0 })
  }

  chooseDuration(duration: DurationName): void {
    this.session.setEntry({ duration })
    this.say(`${capital(plainDurationWord(duration))} selected.`)
  }

  stepDuration(direction: 1 | -1): void {
    const at = DURATIONS.indexOf(this.entry.duration)
    this.chooseDuration(DURATIONS[Math.min(DURATIONS.length - 1, Math.max(0, at + direction))] as DurationName)
  }

  toggleDot(): void {
    this.session.setEntry({ dotted: !this.entry.dotted })
    this.say(this.entry.dotted ? 'Dot on.' : 'Dot off.')
  }

  deleteCurrent(): void {
    const events = this.events()
    const at = this.caretIndex(events)
    const event = events[at]
    if (!event) return
    const { staffId, voice } = this.entry
    this.send((stamp) => [{ id: stamp(), type: 'delete', staffId, voice, target: event.id }])
    this.session.setEntry({ current: events[at - 1]?.id ?? null })
    const words = durationWord(event.duration, event.dots)
    this.say(event.kind === 'note' && event.pitch ? `Deleted ${pitchText(event.pitch)} ${words}.` : `Deleted ${words} rest.`)
  }

  private setField(event: PlacedEvent, field: 'pitch' | 'tie' | 'dynamic' | 'dynamicPlacement', value: unknown): void {
    const { staffId, voice } = this.entry
    this.send((stamp) => [{ id: stamp(), type: 'set', staffId, voice, target: event.id, field, value }])
  }

  private withNote(change: (event: PlacedEvent & { pitch: NonNullable<PlacedEvent['pitch']> }) => void): void {
    const event = this.currentEvent()
    if (event?.kind === 'note' && event.pitch) change(event as PlacedEvent & { pitch: NonNullable<PlacedEvent['pitch']> })
  }

  moveSemitone(up: boolean): void {
    this.withNote((e) => {
      const pitch = moveSemitone(e.pitch, up)
      this.setField(e, 'pitch', pitch)
      this.say(`Now ${pitchText(pitch)}.`)
    })
  }

  moveOctave(up: boolean): void {
    this.withNote((e) => {
      const pitch = moveOctave(e.pitch, up)
      this.setField(e, 'pitch', pitch)
      this.say(`Now ${pitchText(pitch)}.`)
    })
  }

  respell(): void {
    this.withNote((e) => {
      const pitch = respell(e.pitch)
      this.setField(e, 'pitch', pitch)
      this.say(`Respelled as ${pitchText(pitch)}.`)
    })
  }

  toggleTie(): void {
    const event = this.currentEvent()
    if (!event) return
    this.setField(event, 'tie', !event.tie)
    this.say(event.tie ? 'Tie removed.' : 'Tie added.')
  }

  cycleDynamic(): void {
    const event = this.currentEvent()
    if (!event) return
    const next = CYCLE[(CYCLE.findIndex((d) => d === event.dynamic) + 1) % CYCLE.length] ?? null
    this.setField(event, 'dynamic', next)
    this.say(next ? `Dynamic ${next}.` : 'Dynamic removed.')
  }

  flipPlacement(): void {
    const event = this.currentEvent()
    if (!event || event.kind === 'rest') return
    const next = event.dynamicPlacement === 'above' ? 'below' : 'above'
    this.setField(event, 'dynamicPlacement', next)
    this.say(`Dynamic ${next === 'above' ? 'above' : 'below'} the staff.`)
  }

  changeStaff(direction: 1 | -1): void {
    const staves = this.session.getSnapshot().score?.staves ?? []
    const allowed = staves.filter((s) => this.session.me.role !== 'player' || this.session.me.staffIds.includes(s.id))
    const at = allowed.findIndex((s) => s.id === this.entry.staffId)
    const next = allowed[Math.min(allowed.length - 1, Math.max(0, at + direction))]
    if (next) this.session.setEntry({ staffId: next.id, current: null })
    this.announceEntering()
  }

  toggleVoice(): void {
    this.session.setEntry({ voice: this.entry.voice === 1 ? 2 : 1, current: null })
    this.announceEntering()
  }

  selectStaff(staffId: string): void {
    this.session.setEntry({ staffId, current: null })
    this.announceEntering()
  }

  private move(to: 'left' | 'right' | 'home' | 'end'): void {
    const events = this.events()
    const at = this.caretIndex(events)
    const target = { left: at - 1, right: Math.min(events.length - 1, at + 1), home: -1, end: events.length - 1 }[to]
    this.session.setEntry({ current: events[target]?.id ?? null })
  }

  /** Returns true when the key was an editor key. Workspace shortcuts (Shift+P, Shift+E, Shift+H) are not handled here. */
  handleKey(e: KeyboardEvent): boolean {
    const letter = /^Key([A-Z])$/.exec(e.code)?.[1]
    const command = e.ctrlKey || e.metaKey
    if (e.altKey) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.changeStaff(e.key === 'ArrowUp' ? -1 : 1)
      else return false
      return true
    }
    if (e.shiftKey && letter) {
      if (letter === 'D') this.cycleDynamic()
      else if (letter === 'F') this.flipPlacement()
      else return letter === 'P' || letter === 'E' || letter === 'H' ? false : true
      return true
    }
    if (e.shiftKey && !command && /^[0-9]$/.test(e.key)) return true
    if (command && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) this.moveOctave(e.key === 'ArrowUp')
    else if (command) return false
    else if (e.key === 'ArrowLeft') this.move('left')
    else if (e.key === 'ArrowRight') this.move('right')
    else if (e.key === 'Home') this.move('home')
    else if (e.key === 'End') this.move('end')
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.moveSemitone(e.key === 'ArrowUp')
    else if (e.key === 'Backspace') this.deleteCurrent()
    else if (e.key === ' ') this.session.togglePlay()
    else if (e.key === '.') this.toggleDot()
    else if (KEY_DURATION[e.key]) this.chooseDuration(KEY_DURATION[e.key] as DurationName)
    else if (letter && 'ABCDEFG'.includes(letter)) this.enterNote(letter as Step)
    else if (letter === 'R') this.enterRest()
    else if (letter === 'V') this.toggleVoice()
    else if (letter === 'J') this.respell()
    else if (letter === 'T') this.toggleTie()
    else if (letter === 'X') this.openText()
    else return false
    return true
  }
}
