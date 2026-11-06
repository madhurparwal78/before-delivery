/** The polite Announcements region. Text is written straight to the node so it lands in the same event that caused it. */
let region: HTMLElement | null = null;

export function announce(text: string): void {
  if (!region) return;
  // Re-announcing identical copy needs a change; a zero-width space toggles at the end.
  region.textContent = region.textContent === text ? `${text}​` : text;
}

export function AnnouncementsRegion({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Announcements"
      className={`announcements ${className ?? ""}`}
      ref={(el) => {
        region = el;
      }}
    />
  );
}
