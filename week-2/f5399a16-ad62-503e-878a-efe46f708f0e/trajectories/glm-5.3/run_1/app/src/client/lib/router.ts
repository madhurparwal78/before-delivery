// The route table: signed-in screens change at once with no wipe, focus moves
// to the new level-one heading and the title changes; the wipe plays on the
// public pages only. Every committed change is one history entry.

export type ChangeListener = (path: string) => Promise<void>;

export class Router {
  private onChangeHandler: ChangeListener | null = null;
  private onPublicChangeHandler: ChangeListener | null = null;

  onChange(handler: ChangeListener): void {
    this.onChangeHandler = handler;
  }

  onPublicChange(handler: ChangeListener): void {
    this.onPublicChangeHandler = handler;
  }

  // A committed navigation: pushes one history entry and renders.
  async go(path: string): Promise<void> {
    const isPublic = isPublicPath(path);
    history.pushState({}, "", path);
    await this.render(path, isPublic);
  }

  // A committed change that replaces the current entry (a wipe's inner step).
  async replace(path: string): Promise<void> {
    history.replaceState({}, "", path);
    await this.render(path, isPublicPath(path));
  }

  async start(): Promise<void> {
    await this.render(location.pathname + location.search, isPublicPath(location.pathname));
    window.addEventListener("popstate", () => {
      const path = location.pathname + location.search;
      const scroll = (history.state as { scroll?: number } | null)?.scroll;
      void this.render(path, isPublicPath(path)).then(() => {
        if (scroll !== undefined) window.scrollTo(0, scroll);
      });
    });
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a");
      if (link === null || link === undefined) return;
      const href = link.getAttribute("href");
      if (href === null || href.startsWith("http") || href.startsWith("#")) return;
      event.preventDefault();
      const scroll = history.state as { scroll?: number } | null;
      history.replaceState({ ...(scroll ?? {}), scroll: window.scrollY }, "", location.href);
      void this.go(href);
    });
  }

  private async render(path: string, isPublic: boolean): Promise<void> {
    const handler = isPublic ? this.onPublicChangeHandler : this.onChangeHandler;
    await handler?.(path);
  }
}

export function isPublicPath(path: string): boolean {
  if (path.startsWith("/desk") || path.startsWith("/r/") || path.startsWith("/s/") || path.startsWith("/f/")) {
    return false;
  }
  return true;
}
