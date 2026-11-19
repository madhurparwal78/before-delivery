// The sync chime: two Web Audio oscillator notes, rising for success and falling otherwise. No audio file.
let context = null;

export function primeAudio() {
  context ??= new AudioContext();
  if (context.state === "suspended") context.resume();
}

export function chime(succeeded) {
  primeAudio();
  const notes = succeeded ? [660, 880] : [520, 392];
  const start = context.currentTime + 0.02;
  notes.forEach((frequency, index) => {
    const at = start + index * 0.14;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.14);
  });
}
