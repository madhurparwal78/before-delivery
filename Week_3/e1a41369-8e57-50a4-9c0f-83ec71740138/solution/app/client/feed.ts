import { nextTask } from "./format";

let region: HTMLElement | null = null;
let queue: Promise<void> = Promise.resolve();

export function registerFeed(element: HTMLElement | null): void {
  region = element;
}

/** Announce one sentence in the polite "Game feed" region; each sentence lands as its own change. */
export function say(sentence: string): void {
  queue = queue.then(async () => {
    if (region) region.textContent = sentence;
    await nextTask();
  });
}
