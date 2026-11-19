// The preview stage: creates renders, swaps the iframe after the crossfade,
// and accepts console messages only from the current render.
import { Api, type ClientConfig } from "./api.js";

export interface RenderHandle {
  url: string;
  nonce: string;
}

export type PreviewKind = "log" | "info" | "warn" | "error" | "uncaught" | "loop" | "blocked";

export interface PreviewMessage {
  kind: PreviewKind;
  text: string;
  line: number | null;
  title: string | null;
}

export class PreviewStage {
  private iframe: HTMLIFrameElement | null = null;
  private container: HTMLElement;
  private current: RenderHandle | null = null;
  private seq = 0;
  private listeners: Array<(m: PreviewMessage) => void> = [];
  private readyListeners: Array<(title: string | null) => void> = [];

  constructor(container: HTMLElement) {
    this.container = container;
    window.addEventListener("message", (ev) => this.onMessage(ev));
  }

  onEntry(fn: (m: PreviewMessage) => void): void {
    this.listeners.push(fn);
  }

  onReady(fn: (title: string | null) => void): void {
    this.readyListeners.push(fn);
  }

  // The message gate: only the current render's window and nonce are accepted.
  private onMessage(ev: MessageEvent): void {
    if (this.iframe === null) return;
    if (ev.source !== this.iframe.contentWindow) return;
    const data = ev.data as
      | { source?: string; render?: string; nonce?: string; kind?: string; text?: string; line?: number | null; title?: string | null }
      | null;
    if (!data || data.source !== "ashlar-preview") return;
    if (!this.current || data.render !== this.current.url.slice("/preview/".length) || data.nonce !== this.current.nonce) {
      return;
    }
    if (data.kind === "ready") {
      this.seq++;
      this.readyListeners.forEach((fn) => fn(data.title ?? null));
      return;
    }
    const m: PreviewMessage = {
      kind: data.kind as PreviewKind,
      text: data.text ?? "",
      line: data.line ?? null,
      title: null,
    };
    this.listeners.forEach((fn) => fn(m));
  }

  get renderSeq(): number {
    return this.seq;
  }

  // Renders the working copy: post the panes, then swap the iframe once the
  // new document is ready. The swap crossfades over the configured duration.
  async render(panes: { html: string; css: string; js: string }, libraries: string[], config: ClientConfig): Promise<void> {
    const res = await Api.post<RenderHandle>("/api/renders", {
      html: panes.html,
      css: panes.css,
      js: panes.js,
      libraries,
    });
    const url = new URL(res.url, location.origin).toString();
    await this.swap(url, res.nonce);
  }

  async renderPen(penId: string, version: number | null, libraries: string[]): Promise<void> {
    const res = await Api.post<RenderHandle>("/api/renders", {
      pen_id: penId,
      version: version ?? undefined,
      libraries,
    });
    const url = new URL(res.url, location.origin).toString();
    await this.swap(url, res.nonce);
  }

  private swap(url: string, nonce: string): Promise<void> {
    return new Promise((resolve) => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const old = this.iframe;
      const next = document.createElement("iframe");
      next.title = "Pen preview";
      next.setAttribute("sandbox", "allow-scripts");
      next.src = url;
      next.style.opacity = "0";
      this.container.appendChild(next);
      const finish = () => {
        if (old) {
          old.remove();
        }
        this.iframe = next;
        this.current = { url, nonce };
        next.style.opacity = "1";
        resolve();
      };
      if (reduced || old === null) {
        next.addEventListener("load", finish, { once: true });
      } else {
        old.style.opacity = "0";
        next.addEventListener("load", () => {
          setTimeout(finish, 600);
        }, { once: true });
      }
    });
  }
}
