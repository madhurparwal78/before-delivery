import { pitchToMidi } from '../shared/music.js';
import type { SampleBank, Voice } from '../shared/types.js';
import type { Regions } from './regions.js';
import type { ScoreState } from './score-state.js';

const LOOKAHEAD_SECONDS = 0.2;
const BANK_RETRY_MS = 10_000;
const ROOT_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

interface ScheduledNote {
  staffId: string;
  midi: number;
  startSeconds: number;
  seconds: number;
}

interface LoadedBank {
  bankId: string;
  buffer: AudioBuffer;
  rootMidi: number;
}

function rootMidiOf(root: string | null): number {
  if (root === null) return 69;
  const match = /^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d)$/.exec(root);
  if (!match) return 69;
  const step = ROOT_SEMITONES[match[1]!.toUpperCase()]!;
  const accidental = match[2] ?? '';
  const alter = accidental.startsWith('#') ? accidental.length : -accidental.length;
  return (Number(match[3]) + 1) * 12 + step + alter;
}

/** Playback against the tempo map, scheduled ahead of the audio clock. */
export class Playback {
  private context: AudioContext | null = null;
  private clock: AudioWorkletNode | null = null;
  private frames = 0;
  private startedAt = 0;
  private startTick = 0;
  private playing = false;
  private scheduled = 0;
  private clockOriginSeconds = 0;
  private notes: ScheduledNote[] = [];
  private readonly banks = new Map<string, LoadedBank>();
  private readonly failing = new Set<string>();
  private retryTimer: number | null = null;
  onPosition: ((measure: number, beat: number) => void) | null = null;
  onPlayingChange: ((playing: boolean) => void) | null = null;

  constructor(
    private readonly state: ScoreState,
    private readonly regions: Regions,
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  private tempoAt(measure: number): number {
    let bpm = this.state.head.tempos[0]?.bpm ?? 72;
    for (const mark of this.state.head.tempos) {
      if (mark.measure <= measure) bpm = mark.bpm;
    }
    return bpm;
  }

  /** Seconds from the start of the score to a tick, following the tempo map. */
  private secondsAtTick(tick: number): number {
    let seconds = 0;
    let measure = 1;
    let cursor = 0;
    for (;;) {
      const length = this.state.meter.measureTicks(measure);
      const perTick = 60 / (this.tempoAt(measure) * 480);
      if (tick <= cursor + length) return seconds + (tick - cursor) * perTick;
      seconds += length * perTick;
      cursor += length;
      measure += 1;
    }
  }

  private tickAtSeconds(seconds: number): number {
    let elapsed = 0;
    let measure = 1;
    let cursor = 0;
    for (;;) {
      const length = this.state.meter.measureTicks(measure);
      const perTick = 60 / (this.tempoAt(measure) * 480);
      if (seconds <= elapsed + length * perTick) {
        return cursor + (seconds - elapsed) / perTick;
      }
      elapsed += length * perTick;
      cursor += length;
      measure += 1;
      if (measure > this.state.head.measureCount) return cursor;
    }
  }

  private collect(): ScheduledNote[] {
    const notes: ScheduledNote[] = [];
    for (const staff of this.state.head.staves) {
      for (const voice of [1, 2] as Voice[]) {
        let tick = 0;
        for (const event of this.state.events(staff.id, voice)) {
          if (event.kind === 'note' && event.pitch) {
            const start = this.secondsAtTick(tick);
            notes.push({
              staffId: staff.id,
              midi: pitchToMidi(event.pitch),
              startSeconds: start,
              seconds: this.secondsAtTick(tick + event.ticks) - start,
            });
          }
          tick += event.ticks;
        }
      }
    }
    return notes.sort((a, b) => a.startSeconds - b.startSeconds);
  }

  private bankFor(staffId: string): SampleBank | undefined {
    return this.state.banks.find((bank) => bank.staffId === staffId);
  }

  private async loadBank(bank: SampleBank): Promise<void> {
    const context = this.context!;
    try {
      const response = await fetch(
        `/api/scores/${this.state.scoreId}/banks/${bank.id}/content`,
        { headers: { authorization: `Bearer ${sessionStorage.getItem('fairline.seat') ?? ''}` } },
      );
      if (!response.ok) throw new Error('bank unreachable');
      if (bank.kind === 'sfz') {
        const text = await response.text();
        const sample = /sample\s*=\s*([^\s]+)/.exec(text)?.[1];
        const referenced = this.state.banks.find(
          (candidate) => candidate.kind === 'wav' && candidate.fileName === sample,
        );
        if (!referenced) throw new Error('sample missing');
        await this.loadBank(referenced);
        const loaded = this.banks.get(referenced.staffId);
        if (loaded) this.banks.set(bank.staffId, { ...loaded, bankId: bank.id });
        return;
      }
      const bytes = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(bytes);
      this.banks.set(bank.staffId, {
        bankId: bank.id,
        buffer,
        rootMidi: rootMidiOf(bank.rootPitch),
      });
      if (this.failing.delete(bank.staffId)) {
        this.regions.say(
          'Playback',
          `Samples restored for ${this.state.staff(bank.staffId).name}.`,
        );
      }
    } catch {
      this.banks.delete(bank.staffId);
      this.failing.add(bank.staffId);
      this.regions.say(
        'Playback',
        `Sample bank unavailable \u2014 playing ${[...this.failing]
          .map((staffId) => this.state.staff(staffId).name)
          .join(', ')} with the built-in synth.`,
      );
      this.scheduleBankRetry();
    }
  }

  private scheduleBankRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.refreshBanks();
    }, BANK_RETRY_MS);
  }

  private async refreshBanks(): Promise<void> {
    await this.state.reloadBanks().catch(() => undefined);
    for (const staffId of [...this.failing]) {
      const bank = this.bankFor(staffId);
      if (bank) await this.loadBank(bank);
    }
    if (this.failing.size > 0) this.scheduleBankRetry();
  }

  private async ensureContext(): Promise<AudioContext> {
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return this.context;
    }
    const context = new AudioContext();
    this.context = context;
    await context.audioWorklet.addModule('/worklet/clock.js');
    const clock = new AudioWorkletNode(context, 'fairline-clock');
    const silent = context.createGain();
    silent.gain.value = 0;
    clock.connect(silent).connect(context.destination);
    clock.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; frames?: number };
      if (data.type === 'frames' && data.frames !== undefined) {
        this.frames = data.frames;
        this.tick();
      }
    };
    this.clock = clock;
    return context;
  }

  private audioSeconds(): number {
    const context = this.context;
    if (!context || this.clock === null) return 0;
    return this.frames / context.sampleRate;
  }

  async toggle(caretMeasure: number): Promise<void> {
    if (this.playing) {
      this.stop();
      return;
    }
    await this.play(caretMeasure);
  }

  async play(caretMeasure: number): Promise<void> {
    let context: AudioContext;
    try {
      context = await this.ensureContext();
    } catch {
      this.regions.say('Playback', 'Audio is blocked by the browser. Press Play again.');
      return;
    }
    if (context.state !== 'running') {
      this.regions.say('Playback', 'Audio is blocked by the browser. Press Play again.');
      return;
    }
    for (const bank of this.state.banks) {
      if (!this.banks.has(bank.staffId)) await this.loadBank(bank);
    }
    this.notes = this.collect();
    this.startTick = this.state.meter.measureStart(caretMeasure);
    this.startedAt = context.currentTime + 0.08;
    this.clockOriginSeconds = this.audioSeconds() + 0.08;
    this.scheduled = this.secondsAtTick(this.startTick);
    this.playing = true;
    this.onPlayingChange?.(true);
    this.pump();
  }

  stop(): void {
    this.playing = false;
    this.onPlayingChange?.(false);
  }

  private gainFor(staffId: string): number {
    if (this.state.me.role !== 'player') return 0.5;
    return this.state.me.staffIds.includes(staffId) ? 0.6 : 0.3;
  }

  private voiceFor(note: ScheduledNote, when: number): void {
    const context = this.context!;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(this.gainFor(note.staffId), when + 0.015);
    gain.gain.setTargetAtTime(0, when + Math.max(0.05, note.seconds - 0.05), 0.08);
    gain.connect(context.destination);
    const bank = this.banks.get(note.staffId);
    if (bank) {
      const source = context.createBufferSource();
      source.buffer = bank.buffer;
      source.playbackRate.value = 2 ** ((note.midi - bank.rootMidi) / 12);
      source.connect(gain);
      source.start(when);
      source.stop(when + note.seconds + 0.2);
      return;
    }
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * 2 ** ((note.midi - 69) / 12);
    oscillator.connect(gain);
    oscillator.start(when);
    oscillator.stop(when + note.seconds + 0.2);
  }

  /** Notes are scheduled up to about a fifth of a second ahead of the audio clock. */
  private pump(): void {
    if (!this.playing || this.context === null) return;
    const elapsed = this.context.currentTime - this.startedAt;
    const horizon = this.secondsAtTick(this.startTick) + elapsed + LOOKAHEAD_SECONDS;
    const endSeconds = this.secondsAtTick(
      this.state.meter.measureStart(this.state.head.measureCount + 1),
    );
    for (const note of this.notes) {
      if (note.startSeconds < this.scheduled || note.startSeconds > horizon) continue;
      this.voiceFor(note, this.startedAt + note.startSeconds - this.secondsAtTick(this.startTick));
    }
    this.scheduled = horizon;
    if (this.scheduled >= endSeconds && elapsed > endSeconds - this.secondsAtTick(this.startTick)) {
      this.stop();
      return;
    }
    window.setTimeout(() => this.pump(), 60);
  }

  /** The playhead and the readout follow the audio clock, never the screen frame timing. */
  private tick(): void {
    if (!this.playing) return;
    const elapsed = this.audioSeconds() - this.clockOriginSeconds;
    const seconds = Math.max(0, this.secondsAtTick(this.startTick) + elapsed);
    const position = this.state.meter.position(this.tickAtSeconds(seconds));
    this.onPosition?.(position.measure, position.beat);
  }
}
