// Audio clock. Runs on the audio rendering thread and posts the audio time to the main
// thread about every 20 ms; the main thread uses each message as its scheduling tick.
// The DOM library has no AudioWorklet global scope, so the few names used are declared here.

declare const currentTime: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void

const POST_INTERVAL_SECONDS = 0.02

class ClockProcessor extends AudioWorkletProcessor {
  private lastPosted = -Infinity

  process(): boolean {
    if (currentTime - this.lastPosted >= POST_INTERVAL_SECONDS) {
      this.lastPosted = currentTime
      this.port.postMessage({ t: currentTime })
    }
    return true
  }
}

registerProcessor('fairline-clock', ClockProcessor)

export {}
