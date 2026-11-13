// Score playback on Web Audio. Every step, from scheduling notes to bank retries and the end of the
// score, is driven by messages from an AudioWorklet clock, never by timers or animation frames, so
// the position follows the audio clock even when the screen stalls.

import type { Bank } from '../../shared/protocol.js'
import clockUrl from './clock.worklet.ts?worker&url'
import { compileNotes, type ScheduledNote } from './schedule.js'
import { playSampleNote, SampleLibrary } from './samples.js'
import { playSynthNote } from './synth.js'
import { Timeline, type ScorePosition } from './timeline.js'
import type { NoteRequest, NoteVoice, PlaybackEvents, PlaybackScore, PlaybackSource } from './types.js'

const LOOKAHEAD_SECONDS = 0.2
const START_LEAD_SECONDS = 0.1
const TAIL_SECONDS = 0.3
const BANK_RETRY_SECONDS = 10
const MASTER_LEVEL = 0.8
const FULL_VOLUME = 1
const HALF_VOLUME = 0.5
const CLOCK_NAME = 'fairline-clock'
const RESUME_WAIT_MILLISECONDS = 750

const BLOCKED_NOTICE = 'Audio is blocked by the browser. Press Play again.'

interface StaffTrack {
  id: string
  name: string
  bank: Bank | null
  notes: ScheduledNote[]
  next: number
}

interface StaffBank {
  staff: { id: string; name: string }
  bank: Bank | null
}

interface Run {
  node: AudioWorkletNode
  timeline: Timeline
  tracks: StaffTrack[]
  banks: Bank[]
  /** Seconds into the score at which this run began. */
  offset: number
  /** Audio-context time at which the score position `offset` sounds; set by the first clock message. */
  origin: number | null
  lastPosition: ScorePosition | null
  nextRetryAt: number
  retrying: boolean
  voices: Set<NoteVoice>
}

const fallbackNotice = (names: string[]): string => `Sample bank unavailable — playing ${names.join(', ')} with the built-in synth.`
const restoredNotice = (names: string[]): string => `Samples restored for ${names.join(', ')}.`

function clockTime(message: unknown): number | null {
  if (typeof message !== 'object' || message === null) return null
  const t = (message as { t?: unknown }).t
  return typeof t === 'number' && Number.isFinite(t) ? t : null
}

/** Resolves once `ctx` reports running. */
function becomesRunning(ctx: AudioContext): Promise<void> {
  return new Promise((resolve) => {
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') resolve()
    }, { once: true })
  })
}

/** A bounded real-time wait. AbortSignal.timeout runs on the browser's own clock, not the page's timer functions. */
function boundedWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    AbortSignal.timeout(milliseconds).addEventListener('abort', () => resolve(), { once: true })
  })
}

export class Playback {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private clockLoaded: Promise<boolean> | null = null
  private readonly staffGains = new Map<string, GainNode>()
  private readonly library: SampleLibrary
  private readonly failedStaffIds = new Set<string>()
  private run: Run | null = null
  private starting = false
  private generation = 0
  private notice: string | null = null
  private disposed = false

  constructor(
    private readonly source: PlaybackSource,
    private readonly events: PlaybackEvents,
  ) {
    this.library = new SampleLibrary(
      (bank) => this.source.fetchBank(bank),
      (data) => this.requireContext().decodeAudioData(data),
    )
  }

  get playing(): boolean {
    return this.run !== null
  }

  async start(fromMeasure: number): Promise<void> {
    if (this.disposed || this.run || this.starting) return
    this.starting = true
    const generation = ++this.generation
    try {
      await this.begin(fromMeasure, generation)
    } finally {
      if (generation === this.generation) this.starting = false
    }
  }

  stop(): void {
    const run = this.run
    const wasStarting = this.starting
    this.generation++
    this.starting = false
    if (run) {
      const now = this.requireContext().currentTime
      for (const voice of run.voices) voice.stop(now)
      this.release(run)
    }
    if (run || wasStarting) this.events.onState(false)
  }

  dispose(): void {
    this.stop()
    this.disposed = true
    const ctx = this.context
    this.context = null
    this.master = null
    this.clockLoaded = null
    this.staffGains.clear()
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined)
  }

  private requireContext(): AudioContext {
    if (!this.context) throw new Error('The audio context has not been created.')
    return this.context
  }

  private ensureContext(): { ctx: AudioContext; master: GainNode } {
    if (!this.context || !this.master) {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      const master = ctx.createGain()
      master.gain.value = MASTER_LEVEL
      master.connect(ctx.destination)
      this.context = ctx
      this.master = master
    }
    return { ctx: this.context, master: this.master }
  }

  private loadClock(ctx: AudioContext): Promise<boolean> {
    this.clockLoaded ??= ctx.audioWorklet.addModule(clockUrl).then(
      () => true,
      () => false,
    )
    return this.clockLoaded
  }

  /** True once the browser lets the context run: after resume() settles or the context reports running, within a bounded wait. */
  private async audible(ctx: AudioContext, resumed: Promise<void>): Promise<boolean> {
    if (ctx.state !== 'running') {
      await Promise.race([resumed.catch(() => undefined), becomesRunning(ctx), boundedWait(RESUME_WAIT_MILLISECONDS)])
    }
    return ctx.state === 'running'
  }

  private setNotice(next: string | null): void {
    if (next === this.notice) return
    this.notice = next
    this.events.onNotice(next)
  }

  private block(): void {
    this.setNotice(BLOCKED_NOTICE)
    this.events.onState(false)
  }

  private async begin(fromMeasure: number, generation: number): Promise<void> {
    const { ctx, master } = this.ensureContext()
    const resumed = ctx.resume()
    if (this.failedStaffIds.size === 0) this.setNotice(null)

    const score = this.source.score()
    const banks = this.source.banks()
    const staffBanks: StaffBank[] = score.staves.map((staff) => ({ staff, bank: banks.find((b) => b.staffId === staff.id) ?? null }))
    const loading = Promise.all(staffBanks.map(({ bank }) => (bank ? this.library.ensure(bank, banks) : Promise.resolve(true))))
    const clock = this.loadClock(ctx)

    const running = await this.audible(ctx, resumed)
    if (generation !== this.generation) return
    if (!running) return this.block()
    const [loaded, clockReady] = await Promise.all([loading, clock])
    if (generation !== this.generation) return
    if (!clockReady || ctx.state !== 'running') return this.block()

    this.failedStaffIds.clear()
    staffBanks.forEach(({ staff, bank }, i) => {
      if (bank && !loaded[i]) this.failedStaffIds.add(staff.id)
    })
    const failedNames = staffBanks.filter(({ staff }) => this.failedStaffIds.has(staff.id)).map(({ staff }) => staff.name)
    this.setNotice(failedNames.length ? fallbackNotice(failedNames) : null)

    this.launch(ctx, master, score, staffBanks, fromMeasure)
  }

  private launch(ctx: AudioContext, master: GainNode, score: PlaybackScore, staffBanks: StaffBank[], fromMeasure: number): void {
    const timeline = new Timeline(score)
    const startMeasure = Math.min(Math.max(1, Math.floor(fromMeasure)), timeline.measureCount)
    const fromTick = timeline.tickAtMeasure(startMeasure)
    const own = this.source.ownStaffIds
    const tracks: StaffTrack[] = staffBanks.map(({ staff, bank }) => {
      const gain = this.staffGain(ctx, master, staff.id)
      gain.gain.value = own === null || own.includes(staff.id) ? FULL_VOLUME : HALF_VOLUME
      return { id: staff.id, name: staff.name, bank, notes: compileNotes(this.source.events(staff.id), timeline, fromTick), next: 0 }
    })

    const node = new AudioWorkletNode(ctx, CLOCK_NAME, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] })
    node.connect(master)
    const run: Run = {
      node, timeline, tracks, banks: this.source.banks(), offset: timeline.startOfMeasure(startMeasure), origin: null,
      lastPosition: null, nextRetryAt: 0, retrying: false, voices: new Set(),
    }
    this.run = run
    node.port.onmessage = (message: MessageEvent<unknown>) => this.tick(run, message.data)
    this.events.onState(true)
    this.report(run, run.offset)
  }

  private staffGain(ctx: AudioContext, master: GainNode, staffId: string): GainNode {
    let gain = this.staffGains.get(staffId)
    if (!gain) {
      gain = ctx.createGain()
      gain.connect(master)
      this.staffGains.set(staffId, gain)
    }
    return gain
  }

  private release(run: Run): void {
    run.node.port.onmessage = null
    run.node.port.close()
    run.node.disconnect()
    if (this.run === run) this.run = null
  }

  private tick(run: Run, message: unknown): void {
    const reported = clockTime(message)
    if (this.run !== run || reported === null) return
    const now = Math.max(reported, this.requireContext().currentTime)
    if (run.origin === null) {
      run.origin = now + START_LEAD_SECONDS
      run.nextRetryAt = run.origin + BANK_RETRY_SECONDS
    }
    const position = run.offset + Math.max(0, now - run.origin)
    if (position >= run.timeline.endSeconds + TAIL_SECONDS) {
      this.report(run, run.timeline.endSeconds)
      this.release(run)
      this.events.onState(false)
      return
    }
    this.report(run, position)
    this.schedule(run, run.origin, now)
    this.retryBanks(run, now)
  }

  private report(run: Run, seconds: number): void {
    const position = run.timeline.positionAt(seconds)
    const last = run.lastPosition
    if (last && last.measure === position.measure && last.beat === position.beat) return
    run.lastPosition = position
    this.events.onPosition(position)
  }

  private schedule(run: Run, origin: number, now: number): void {
    const ctx = this.requireContext()
    for (const track of run.tracks) {
      for (let note = track.notes[track.next]; note; note = track.notes[track.next]) {
        const when = origin + note.at - run.offset
        if (when > now + LOOKAHEAD_SECONDS) break
        track.next++
        const late = Math.max(0, ctx.currentTime - when)
        if (late >= note.length) continue
        this.sound(run, ctx, track, { midi: note.midi, when: when + late, length: note.length - late, level: note.level })
      }
    }
  }

  private sound(run: Run, ctx: AudioContext, track: StaffTrack, request: NoteRequest): void {
    const destination = this.staffGains.get(track.id)
    if (!destination) return
    const sample = track.bank ? this.library.voiceFor(track.bank, request.midi) : null
    const ended = (): void => {
      run.voices.delete(voice)
    }
    const voice = sample ? playSampleNote(ctx, destination, sample, request, ended) : playSynthNote(ctx, destination, request, ended)
    run.voices.add(voice)
  }

  private retryBanks(run: Run, now: number): void {
    if (this.failedStaffIds.size === 0 || run.retrying || now < run.nextRetryAt) return
    run.retrying = true
    run.nextRetryAt = now + BANK_RETRY_SECONDS
    void this.retry(run)
  }

  private async retry(run: Run): Promise<void> {
    const wanted = run.tracks.filter((track): track is StaffTrack & { bank: Bank } => track.bank !== null && this.failedStaffIds.has(track.id))
    const results = await Promise.all(wanted.map((track) => this.library.ensure(track.bank, run.banks)))
    run.retrying = false
    const restored = wanted.filter((_, i) => results[i])
    for (const track of restored) this.failedStaffIds.delete(track.id)
    if (restored.length > 0 && this.run === run) this.setNotice(restoredNotice(restored.map((track) => track.name)))
  }
}
