// `status "Announcements"` sits outside the app root from first paint; each message replaces its node.

export function announce(message: string): void {
  const region = document.getElementById('announcements') as HTMLElement;
  const line = document.createElement('span');
  line.textContent = message;
  region.replaceChildren(line);
}
