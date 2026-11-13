// The Wren status region: a polite live region present from first paint. Messages are written one task apart
// so every one of them is observed, each exactly once.
const queue: string[] = [];
let pumping = false;
let clearTimer: ReturnType<typeof setTimeout> | undefined;
const channel = new MessageChannel();
let wake: (() => void) | null = null;
channel.port1.onmessage = () => {
  const resume = wake;
  wake = null;
  resume?.();
};

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    wake = resolve;
    channel.port2.postMessage(0);
  });
}

export function announce(text: string): void {
  queue.push(text);
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  while (queue.length > 0) {
    const region = document.getElementById("wren-status");
    if (region) region.textContent = queue.shift() as string;
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      if (region) region.textContent = "";
    }, 7000);
    await nextTask();
  }
  pumping = false;
}
