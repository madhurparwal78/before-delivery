/**
 * The published game sounds, made only with Web Audio oscillators. No audio
 * file is shipped or fetched, and while Sound is off no oscillator is started.
 */

type Cue =
  | 'seat-taken'
  | 'move-accepted'
  | 'move-refused'
  | 'turn-warning'
  | 'game-won'
  | 'game-lost';

const VOICES: Readonly<Record<Cue, readonly { hertz: number; at: number; length: number }[]>> = {
  'seat-taken': [
    { hertz: 392, at: 0, length: 0.1 },
    { hertz: 587, at: 0.09, length: 0.12 },
  ],
  'move-accepted': [{ hertz: 660, at: 0, length: 0.08 }],
  'move-refused': [{ hertz: 150, at: 0, length: 0.16 }],
  'turn-warning': [{ hertz: 880, at: 0, length: 0.18 }],
  'game-won': [
    { hertz: 523, at: 0, length: 0.11 },
    { hertz: 659, at: 0.1, length: 0.11 },
    { hertz: 784, at: 0.2, length: 0.16 },
  ],
  'game-lost': [
    { hertz: 330, at: 0, length: 0.14 },
    { hertz: 196, at: 0.13, length: 0.2 },
  ],
};

let context: AudioContext | null = null;
let soundOn = false;

export function setSoundOn(on: boolean): void {
  soundOn = on;
}

export function play(cue: Cue): void {
  if (!soundOn) return;
  if (context === null) context = new AudioContext();
  const audio = context;
  if (audio.state === 'suspended') void audio.resume();

  const now = audio.currentTime;
  for (const voice of VOICES[cue]) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = voice.hertz;
    gain.gain.setValueAtTime(0.0001, now + voice.at);
    gain.gain.exponentialRampToValueAtTime(0.22, now + voice.at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.at + voice.length);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now + voice.at);
    oscillator.stop(now + voice.at + voice.length + 0.02);
  }
}
