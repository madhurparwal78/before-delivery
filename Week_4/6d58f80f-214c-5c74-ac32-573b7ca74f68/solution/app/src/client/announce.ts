// The one polite live region (brief: Feedback states). Each announcement is a new line in the region, so a repeated
// message is heard again; older lines drop off.
let region: HTMLElement | null = null;
const KEEP = 3;

export function bindAnnouncer(element: HTMLElement | null): void {
  region = element;
}

export function announce(text: string): void {
  if (!region) return;
  const line = document.createElement("p");
  line.textContent = text;
  region.append(line);
  while (region.childElementCount > KEEP) region.firstElementChild?.remove();
}
