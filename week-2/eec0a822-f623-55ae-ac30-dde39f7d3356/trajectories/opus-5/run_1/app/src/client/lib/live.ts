function region(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function announce(message: string): void {
  const host = region('announcements');
  if (host === null) return;
  host.textContent = message;
}

export function announcePassage(message: string): void {
  const host = region('passage-updates');
  if (host === null) return;
  host.textContent = message;
}

export function clearAnnouncements(): void {
  const host = region('announcements');
  if (host !== null) host.textContent = '';
}
