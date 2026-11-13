// Sample banks: WAV banks decoded with the Web Audio decoder, SFZ banks parsed into key regions
// whose `sample=` names a WAV bank of the same score by file name.

import { parseRoot, pitchMidi, type Pitch } from '../../shared/music.js'
import type { Bank } from '../../shared/protocol.js'
import { fadeOut, SAMPLE_ADSR, shapeEnvelope } from './synth.js'
import type { NoteRequest, NoteVoice } from './types.js'

const DEFAULT_ROOT: Pitch = { step: 'A', alter: 0, octave: 4 }
const SFZ_DEFAULT_KEYCENTER = 60
const SAMPLE_PEAK = 0.45
const FADE_SECONDS = 0.03

interface SfzRegion {
  sample: string
  lowKey: number
  highKey: number
  keyCenter: number
}

interface SampleVoice {
  buffer: AudioBuffer
  rootMidi: number
}

interface SfzProgram {
  regions: (SfzRegion & { sampleBankId: string | null })[]
}

type Opcodes = Record<string, string>

const SFZ_TOKEN = /<(\w+)>|(\w+)=((?:(?!\s+\w+=)[^\n<])*)/g
const NOTE_NAME = /^([a-g])([#b]?)(-?\d+)$/i
const NOTE_PITCH_CLASS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

function parseKey(value: string | undefined): number | null {
  if (value === undefined) return null
  if (/^-?\d+$/.test(value)) return Number(value)
  const m = NOTE_NAME.exec(value)
  if (!m) return null
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return (Number(m[3]) + 1) * 12 + (NOTE_PITCH_CLASS[(m[1] as string).toLowerCase()] as number) + alter
}

/** Reads every `<region>` with a `sample=`, inheriting `<global>`, `<master>` and `<group>` opcodes. */
function parseSfz(text: string): SfzRegion[] {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  let global: Opcodes = {}
  let master: Opcodes = {}
  let group: Opcodes = {}
  let region: Opcodes | null = null
  let target: Opcodes | null = null
  const regions: SfzRegion[] = []

  const finish = (): void => {
    if (!region) return
    const opcodes = { ...global, ...master, ...group, ...region }
    region = null
    const sample = opcodes.sample?.trim().replace(/\\/g, '/').split('/').pop()
    if (!sample) return
    const key = parseKey(opcodes.key)
    const lowKey = parseKey(opcodes.lokey) ?? key ?? 0
    const highKey = parseKey(opcodes.hikey) ?? key ?? 127
    regions.push({ sample, lowKey, highKey, keyCenter: parseKey(opcodes.pitch_keycenter) ?? key ?? SFZ_DEFAULT_KEYCENTER })
  }

  for (const token of source.matchAll(SFZ_TOKEN)) {
    const header = token[1]
    if (header !== undefined) {
      finish()
      if (header === 'global') {
        global = {}
        master = {}
        group = {}
        target = global
      } else if (header === 'master') {
        master = {}
        group = {}
        target = master
      } else if (header === 'group') {
        group = {}
        target = group
      } else if (header === 'region') {
        region = {}
        target = region
      } else {
        target = null
      }
    } else if (target) {
      target[token[2] as string] = (token[3] as string).trim()
    }
  }
  finish()
  return regions
}

function rootMidiOf(bank: Bank): number {
  return pitchMidi(parseRoot(bank.rootPitch ?? 'A4') ?? DEFAULT_ROOT)
}

/** Decoded buffers and parsed SFZ programs, cached by bank id for the life of the editor. */
export class SampleLibrary {
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly programs = new Map<string, SfzProgram>()
  private readonly pending = new Map<string, Promise<boolean>>()

  constructor(
    private readonly fetchBank: (bank: Bank) => Promise<ArrayBuffer>,
    private readonly decode: (data: ArrayBuffer) => Promise<AudioBuffer>,
  ) {}

  /** Loads the bank, and for an SFZ bank the WAV banks its regions name. Resolves false, never rejects, when anything fails. */
  async ensure(bank: Bank, banks: readonly Bank[]): Promise<boolean> {
    if (bank.kind === 'wav') return this.ensureWav(bank)
    if (!this.programs.has(bank.id)) {
      const parsed = await this.once(bank.id, async () => {
        const text = new TextDecoder().decode(await this.fetchBank(bank))
        const regions = parseSfz(text).map((region) => ({ ...region, sampleBankId: banks.find((b) => b.kind === 'wav' && b.fileName === region.sample)?.id ?? null }))
        this.programs.set(bank.id, { regions })
        return true
      })
      if (!parsed) return false
    }
    const program = this.programs.get(bank.id)
    if (!program) return false
    const wanted = new Set<string>()
    for (const region of program.regions) if (region.sampleBankId) wanted.add(region.sampleBankId)
    const loads = [...wanted].map((id) => banks.find((b) => b.id === id)).filter((b): b is Bank => b !== undefined)
    return (await Promise.all(loads.map((b) => this.ensureWav(b)))).every(Boolean)
  }

  /** The loaded sample that sounds `midi` for the bank, or null when the synth must play it. */
  voiceFor(bank: Bank, midi: number): SampleVoice | null {
    if (bank.kind === 'wav') {
      const buffer = this.buffers.get(bank.id)
      return buffer ? { buffer, rootMidi: rootMidiOf(bank) } : null
    }
    for (const region of this.programs.get(bank.id)?.regions ?? []) {
      if (midi < region.lowKey || midi > region.highKey || !region.sampleBankId) continue
      const buffer = this.buffers.get(region.sampleBankId)
      if (buffer) return { buffer, rootMidi: region.keyCenter }
    }
    return null
  }

  private ensureWav(bank: Bank): Promise<boolean> {
    if (this.buffers.has(bank.id)) return Promise.resolve(true)
    return this.once(bank.id, async () => {
      const data = await this.fetchBank(bank)
      this.buffers.set(bank.id, await this.decode(data.slice(0)))
      return true
    })
  }

  private once(key: string, work: () => Promise<boolean>): Promise<boolean> {
    const running = this.pending.get(key)
    if (running) return running
    const started = work()
      .catch(() => false)
      .finally(() => this.pending.delete(key))
    this.pending.set(key, started)
    return started
  }
}

export function playSampleNote(ctx: BaseAudioContext, destination: AudioNode, sample: SampleVoice, note: NoteRequest, onEnded: () => void): NoteVoice {
  const source = ctx.createBufferSource()
  source.buffer = sample.buffer
  const rate = 2 ** ((note.midi - sample.rootMidi) / 12)
  source.playbackRate.value = rate
  if (sample.buffer.duration / rate < note.length) {
    source.loop = true
    source.loopStart = sample.buffer.duration > 1 ? sample.buffer.duration / 2 : 0
    source.loopEnd = sample.buffer.duration
  }
  const envelope = ctx.createGain()
  envelope.gain.value = 0
  source.connect(envelope)
  envelope.connect(destination)

  const stopAt = shapeEnvelope(envelope.gain, note.when, note.length, SAMPLE_PEAK * note.level, SAMPLE_ADSR)
  source.start(note.when)
  source.stop(stopAt)
  source.onended = () => {
    source.disconnect()
    envelope.disconnect()
    onEnded()
  }
  return {
    stop(now: number): void {
      fadeOut(envelope.gain, now)
      source.stop(now + FADE_SECONDS * 2)
    },
  }
}
