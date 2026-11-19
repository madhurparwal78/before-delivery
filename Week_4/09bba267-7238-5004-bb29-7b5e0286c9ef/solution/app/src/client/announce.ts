// The page's one polite `status "Box office updates"` region. Each announcement clears the region and writes its
// text in a later microtask, so every result is announced once, even the same words twice in a row.

let region: HTMLElement | null = null;
const queue: string[] = [];
let writing = false;

export function setRegion(element: HTMLElement | null): void {
  region = element;
}

function writeNext(): void {
  const text = queue.shift();
  if (text === undefined || !region) {
    writing = false;
    return;
  }
  const target = region;
  target.textContent = "";
  queueMicrotask(() => {
    target.textContent = text;
    queueMicrotask(writeNext);
  });
}

export function announce(text: string): void {
  queue.push(text);
  if (writing) return;
  writing = true;
  writeNext();
}
