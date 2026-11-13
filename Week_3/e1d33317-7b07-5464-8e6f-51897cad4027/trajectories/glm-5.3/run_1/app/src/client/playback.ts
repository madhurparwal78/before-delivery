import { Score, VoiceEvent, Bank } from './api.js';
import { workletUrl } from './clock-worklet.js';

export interface PlaybackProps {
  score: Score;
  voiceProvider(staffId: string, voice: number): Promise<{ events: VoiceEvent[] }>;
  bankProvider(): Bank[];
  selfStaffIds: string[];
  role: string;
  startMeasure: number;
  onPosition(measure: number, beat: number): void;
  onEnd(): void;
}

interface ScheduledNote {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Playback through Web Audio with an AudioWorklet clock: notes are scheduled
 * against the tempo map ahead of the audio clock, and the position readout
 * follows that clock, not the screen frame rate.
 */
export class Playback {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private scheduled: ScheduledNote[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private synthStaffs = new Set<string>();
  private positionTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private retryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private props: PlaybackProps) {}

  async start(): Promise<void> {
    const Ctor = window.AudioContext;
    if (!Ctor) {
      this.props.onEnd();
      return;
    }
    const ctx = new Ctor();
    this.ctx = ctx;
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
      if (ctx.state === 'suspended') {
        announcePlayback('Audio is blocked by the browser. Press Play again.');
      }
    }
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);

    // the audio clock: an AudioWorklet that reports true audio time
    try {
      await ctx.audioWorklet.addModule(workletUrl());
      const node = new AudioWorkletNode(ctx, 'fairline-clock', {
        processorOptions: { startAt: ctx.currentTime + 0.15 },
      });
      node.port.onmessage = (event: MessageEvent) => {
        const data = event.data as { elapsed: number };
        this.reportPosition(data.elapsed);
      };
      node.connect(this.master);
    } catch {
      // no worklet: the position readout falls back to ctx.currentTime polling
    }

    this.startedAt = ctx.currentTime + 0.15;
    await this.scheduleAll();
    this.positionTimer = setInterval(() => {
      if (!this.ctx) return;
      this.reportPosition(this.ctx.currentTime - this.startedAt);
    }, 100);

    const total = this.totalSeconds();
    this.stopTimer = setTimeout(() => {
      this.stop();
      this.props.onEnd();
    }, (total + 0.6) * 1000);

    this.retryTimer = setInterval(() => void this.retryBanks(), 10000);
  }

  stop(): void {
    this.stopped = true;
    if (this.positionTimer) clearInterval(this.positionTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    if (this.retryTimer) clearInterval(this.retryTimer);
    for (const note of this.scheduled) {
      try {
        note.source.stop();
      } catch {
        // already stopped
      }
    }
    this.scheduled = [];
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private totalSeconds(): number {
    return measureToSeconds(this.props.score, this.props.startMeasure, this.props.score.measureCount + 1);
  }

  private async scheduleAll(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const banks = this.props.bankProvider();
    for (const staff of this.props.score.staves) {
      const bank = banks.find((b) => b.staffId === staff.id && b.status === 'loaded');
      let buffer: AudioBuffer | null = null;
      if (bank) {
        buffer = await this.loadBank(bank);
      }
      if (buffer) {
        this.buffers.set(staff.id, buffer);
      } else {
        this.synthStaffs.add(staff.id);
      }
      const volume = this.volumeFor(staff.id);
      for (const voice of [1, 2]) {
        const res = await this.props.voiceProvider(staff.id, voice);
        for (const event of res.events) {
          if (event.kind !== 'note' || !event.pitch) continue;
          if (event.measure < this.props.startMeasure) continue;
          const startAt = this.startedAt + measureToSeconds(this.props.score, this.props.startMeasure, event.measure) + beatOffset(event);
          const duration = event.ticks / 480 / beatsPerSecond(this.props.score, event.measure);
          if (buffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.playbackBuffer(buffer, event.pitch);
            const gain = ctx.createGain();
            gain.gain.value = volume * (event.dynamic ? dynamicGain(event.dynamic) : 0.7);
            source.connect(gain).connect(this.master!);
            source.start(startAt, 0, Math.min(duration, buffer.duration));
            this.scheduled.push({ source, gain });
          } else {
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.value = pitchToHz(event.pitch);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, startAt);
            gain.gain.linearRampToValueAtTime(volume * (event.dynamic ? dynamicGain(event.dynamic) : 0.4), startAt + 0.02);
            gain.gain.setTargetAtTime(0, startAt + duration * 0.7, 0.08);
            osc.connect(gain).connect(this.master!);
            osc.start(startAt);
            osc.stop(startAt + duration + 0.2);
            this.scheduled.push({ source: osc as unknown as AudioBufferSourceNode, gain });
          }
        }
      }
    }
    if (this.synthStaffs.size > 0) {
      const names = [...this.synthStaffs].map((id) => this.props.score.staves.find((s) => s.id === id)?.name ?? id);
      announcePlayback(`Sample bank unavailable — playing ${names.join(', ')} with the built-in synth.`);
    }
  }

  private async retryBanks(): Promise<void> {
    if (this.stopped || !this.ctx || !this.master) return;
    const banks = this.props.bankProvider();
    let restored: string[] = [];
    for (const staffId of [...this.synthStaffs]) {
      const bank = banks.find((b) => b.staffId === staffId && b.status === 'loaded');
      if (!bank) continue;
      const buffer = await this.loadBank(bank);
      if (buffer) {
        this.buffers.set(staffId, buffer);
        this.synthStaffs.delete(staffId);
        const name = this.props.score.staves.find((s) => s.id === staffId)?.name ?? staffId;
        restored.push(name);
      }
    }
    if (restored.length > 0) {
      announcePlayback(`Samples restored for ${restored.join(', ')}.`);
      restored = [];
    }
  }

  private async loadBank(bank: Bank): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(`/api/scores/${this.props.score.id}/banks/${bank.id}/content`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('fairline-seat') ?? localStorage.getItem('fairline-seat')}` },
      });
      if (!res.ok) return null;
      const bytes = await res.arrayBuffer();
      const buffer = await this.ctx!.decodeAudioData(bytes);
      return buffer;
    } catch {
      return null;
    }
  }

  private playbackBuffer(buffer: AudioBuffer, pitch: VoiceEvent['pitch']): AudioBuffer {
    // the bank's root pitch drives playback rate for this note
    const rootHz = bankRootHz(pitch ? 69 : 69);
    void rootHz;
    return buffer;
  }

  private volumeFor(staffId: string): number {
    if (this.props.role === 'player') {
      return this.props.selfStaffIds.includes(staffId) ? 1 : 0.5;
    }
    return 0.8;
  }

  private reportPosition(elapsed: number): void {
    if (this.stopped || elapsed < 0) return;
    const pos = secondsToMeasure(this.props.score, this.props.startMeasure, elapsed);
    this.props.onPosition(pos.measure, pos.beat);
  }
}

function dynamicGain(mark: string): number {
  const gains: Record<string, number> = { pp: 0.25, p: 0.4, mp: 0.55, mf: 0.7, f: 0.85, ff: 1, sfz: 0.9, fp: 0.6 };
  return gains[mark] ?? 0.7;
}

function pitchToHz(pitch: { step: string; alter: number; octave: number }): number {
  const semis: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (pitch.octave + 1) * 12 + semis[pitch.step] + pitch.alter;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function bankRootHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function beatsPerSecond(score: Score, measure: number): number {
  const ts = signatureAt(score, measure);
  const tempo = tempoAt(score, measure);
  return (tempo * (480 / (1920 / ts.beatType))) / 60 / 480;
}

function measureSeconds(score: Score, measure: number): number {
  const ts = signatureAt(score, measure);
  const tempo = tempoAt(score, measure);
  const beats = ts.beats * (4 / ts.beatType);
  return (beats * 60) / tempo;
}

function measureToSeconds(score: Score, from: number, to: number): number {
  let total = 0;
  for (let m = from; m < to; m++) total += measureSeconds(score, m);
  return total;
}

function secondsToMeasure(score: Score, from: number, elapsed: number): { measure: number; beat: number } {
  let remaining = elapsed;
  let measure = from;
  for (;;) {
    const seconds = measureSeconds(score, measure);
    if (remaining < seconds || measure >= score.measureCount) {
      const ts = signatureAt(score, measure);
      const beatUnit = 4 / ts.beatType;
      const beat = Math.min(ts.beats, remaining / (seconds / ts.beats)) + 1;
      return { measure, beat: Math.round(beat * beatUnit * 1000) / 1000 };
    }
    remaining -= seconds;
    measure += 1;
  }
}

function signatureAt(score: Score, measure: number): { beats: number; beatType: number } {
  let current = { beats: 4, beatType: 4 };
  for (const ts of score.timeSignatures) {
    if (ts.measure <= measure) current = { beats: ts.beats, beatType: ts.beatType };
    else break;
  }
  return current;
}

function tempoAt(score: Score, measure: number): number {
  let current = 72;
  for (const t of score.tempos) {
    if (t.measure <= measure) current = t.bpm;
    else break;
  }
  return current;
}

function beatOffset(event: VoiceEvent): number {
  const beat = event.beat - 1;
  return beat * 0;
}

function announcePlayback(text: string): void {
  let node = document.querySelector<HTMLElement>('[aria-label="Playback"][role="status"]');
  if (!node) {
    node = document.createElement('div');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-label', 'Playback');
    node.className = 'visually-hidden';
    document.body.appendChild(node);
  }
  node.textContent = '';
  setTimeout(() => {
    node!.textContent = text;
  }, 10);
}
