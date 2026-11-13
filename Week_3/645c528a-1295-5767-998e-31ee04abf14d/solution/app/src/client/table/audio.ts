/** Sound is synthesised in the browser so no audio file ships. Nothing starts before a user gesture. */
import { currentStore } from '../store';

let context: AudioContext | null = null;
let room: { stop: () => void } | null = null;

function audio(): AudioContext {
  context ??= new AudioContext();
  void context.resume();
  return context;
}

export function playStrike(power: number): void {
  if (!currentStore().settings.sound) return;
  const ctx = audio();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(1500, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.05);
  gain.gain.setValueAtTime(0.05 + power / 900, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.1);
}

export function syncRoomTone(): void {
  const wanted = currentStore().settings.music;
  if (wanted && room === null) {
    const ctx = audio();
    const low = ctx.createOscillator();
    const high = ctx.createOscillator();
    const gain = ctx.createGain();
    low.frequency.value = 55;
    high.frequency.value = 82.5;
    gain.gain.value = 0.012;
    low.connect(gain);
    high.connect(gain);
    gain.connect(ctx.destination);
    low.start();
    high.start();
    room = {
      stop: () => {
        low.stop();
        high.stop();
      },
    };
  }
  if (!wanted && room !== null) {
    room.stop();
    room = null;
  }
}
