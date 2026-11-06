/** The Sound cues, made only with Web Audio oscillators while Sound is on. */

let audioContext: AudioContext | null = null;
let soundOn = false;

export function setSound(on: boolean): void {
  soundOn = on;
  if (on && audioContext === null) {
    audioContext = new AudioContext();
  }
}

export function soundEnabled(): boolean {
  return soundOn;
}

function tone(freq: number, start: number, duration: number): void {
  if (!soundOn || audioContext === null) return;
  const ctx = audioContext;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = "square";
  gain.gain.setValueAtTime(0.08, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

export const Cues = {
  seatTaken(): void {
    tone(523, 0, 0.12);
    tone(784, 0.12, 0.18);
  },
  moveAccepted(): void {
    tone(660, 0, 0.14);
  },
  moveRefused(): void {
    tone(220, 0, 0.16);
  },
  clockWarning(): void {
    tone(880, 0, 0.12);
  },
  gameWon(): void {
    tone(523, 0, 0.12);
    tone(659, 0.12, 0.12);
    tone(784, 0.24, 0.22);
  },
  gameLost(): void {
    tone(392, 0, 0.18);
    tone(262, 0.18, 0.28);
  },
};
