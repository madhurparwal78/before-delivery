type Context = AudioContext & { webkitAudioContext?: never };

let context: Context | null = null;

function audioContext(): Context | null {
  if (typeof window === "undefined") return null;
  if (context === null) {
    const Factory = window.AudioContext;
    if (!Factory) return null;
    context = new Factory() as Context;
  }
  return context;
}

/** A finished job's two-note chime: one Web Audio oscillator per note, no audio file. */
export function playChime(outcome: "succeeded" | "failed" | "cancelled"): void {
  const audio = audioContext();
  if (audio === null) return;
  void audio.resume();
  const notes = outcome === "succeeded" ? [523.25, 783.99] : [523.25, 329.63];
  notes.forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const startAt = audio.currentTime + index * 0.16;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.3);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.32);
  });
}
