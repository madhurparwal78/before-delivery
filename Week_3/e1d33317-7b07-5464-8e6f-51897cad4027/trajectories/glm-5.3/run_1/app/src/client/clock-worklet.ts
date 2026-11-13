export const CLOCK_WORKLET = `
class ClockProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.startAt = options.processorOptions.startAt;
    this.tempoMap = options.processorOptions.tempoMap;
    this.tick = 0;
    this.lastReport = 0;
  }
  process() {
    const now = currentTime;
    if (now >= this.lastReport + 0.05) {
      this.lastReport = now;
      this.port.postMessage({ audioTime: now, elapsed: Math.max(0, now - this.startAt) });
    }
    return true;
  }
}
registerProcessor('fairline-clock', ClockProcessor);
`;

export function workletUrl(): string {
  return URL.createObjectURL(new Blob([CLOCK_WORKLET], { type: 'application/javascript' }));
}
