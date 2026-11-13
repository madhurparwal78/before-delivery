// The resolution chime: a short bell through one master gain, only when Sound is on.

let context: AudioContext | null = null;
let master: GainNode | null = null;

export function chime(): void {
  context ??= new AudioContext();
  if (!master) {
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
  }
  void context.resume();
  const now = context.currentTime;
  for (const [frequency, delay] of [
    [659.25, 0],
    [987.77, 0.09],
  ] as const) {
    const tone = context.createOscillator();
    const envelope = context.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, now + delay);
    envelope.gain.linearRampToValueAtTime(0.25, now + delay + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.9);
    tone.connect(envelope).connect(master);
    tone.start(now + delay);
    tone.stop(now + delay + 1);
  }
}
