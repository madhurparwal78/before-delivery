interface BrowserSettings {
  squareRowRevealMs: number;
  timeZone: string;
}

function read(): BrowserSettings {
  const node = document.getElementById('fernsquare-settings');
  return JSON.parse(node?.textContent ?? '{}') as BrowserSettings;
}

export const settings = read();

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
