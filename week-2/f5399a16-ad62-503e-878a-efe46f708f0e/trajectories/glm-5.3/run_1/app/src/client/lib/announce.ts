// The one live region: present from first paint, and a message made twice in
// a row is announced twice, with the region's content changing each time.

export class Announcer {
  private region: HTMLElement;
  private last = "";

  constructor() {
    this.region = document.createElement("div");
    this.region.setAttribute("role", "status");
    this.region.setAttribute("aria-live", "polite");
    this.region.id = "announcements";
    this.region.style.position = "absolute";
    this.region.style.width = "1px";
    this.region.style.height = "1px";
    this.region.style.overflow = "hidden";
    this.region.style.clip = "rect(0 0 0 0)";
    document.body.appendChild(this.region);
  }

  element(): HTMLElement {
    return this.region;
  }

  announce(text: string): void {
    // A repeated message must be announced again, so the region's content is
    // rewritten with a changing marker.
    const marker = this.last === text ? `\u200b${text}` : text;
    this.last = text;
    this.region.textContent = marker;
  }
}
