import { copy } from "./copy.js";
import { el } from "./dom.js";
import type { Frame } from "./types.js";

const FIRST_RETRY_MS = 1000;
const LATER_RETRY_MS = 2000;
const REPLAY_QUIET_MS = 120;

/**
 * Live holds the page's one socket. It resumes from the last sequence the
 * page applied, applies missed events in order, and shows the published
 * banner while it is down.
 */
export class Live {
  private socket: WebSocket | null = null;
  private seq: number;
  private retryTimer = 0;
  private quietTimer = 0;
  private attempts = 0;
  private open = false;
  private banner: HTMLElement | null = null;
  private readonly onFrame: (frame: Frame) => void;
  private readonly listeners: ((open: boolean) => void)[] = [];

  constructor(seq: number, onFrame: (frame: Frame) => void) {
    this.seq = seq;
    this.onFrame = onFrame;
  }

  /** start opens the page's socket as the page loads. */
  start(): void {
    this.connect();
  }

  /** isOpen reports whether the page may send a bid yet. */
  isOpen(): boolean {
    return this.open;
  }

  /** onReadyChange watches the socket so Place bid can wait for it. */
  onReadyChange(listener: (open: boolean) => void): void {
    this.listeners.push(listener);
    listener(this.open);
  }

  private announceState(open: boolean): void {
    this.open = open;
    for (const listener of this.listeners) listener(open);
  }

  private connect(): void {
    window.clearTimeout(this.retryTimer);
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${scheme}//${window.location.host}/api/live?since=${this.seq}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.attempts = 0;
      this.announceState(true);
      this.scheduleBannerRemoval();
    });
    socket.addEventListener("message", (event) => {
      this.scheduleBannerRemoval();
      let frame: Frame;
      try {
        frame = JSON.parse(String(event.data)) as Frame;
      } catch {
        return;
      }
      if (frame.seq <= this.seq) return;
      this.seq = frame.seq;
      this.onFrame(frame);
    });
    socket.addEventListener("close", () => this.dropped(socket));
    socket.addEventListener("error", () => this.dropped(socket));
  }

  private dropped(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.announceState(false);
    this.showBanner();
    const wait = this.attempts === 0 ? FIRST_RETRY_MS : LATER_RETRY_MS;
    this.attempts += 1;
    this.retryTimer = window.setTimeout(() => this.connect(), wait);
  }

  /** retry reconnects at once, as the banner's Retry now link asks. */
  retry(): void {
    window.clearTimeout(this.retryTimer);
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.close();
    }
    this.attempts = 0;
    this.connect();
  }

  private showBanner(): void {
    window.clearTimeout(this.quietTimer);
    if (this.banner) return;
    const holder = document.getElementById("banner");
    if (!holder) return;
    const retry = el("a", { class: "banner-retry", href: "#", text: copy.retryNow });
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      this.retry();
    });
    this.banner = el("div", { class: "banner", role: "alert" }, [
      el("span", { text: copy.connectionLost }),
      " ",
      retry,
    ]);
    holder.append(this.banner);
  }

  /**
   * scheduleBannerRemoval takes the banner down once the socket is open again
   * and the replayed events have stopped arriving.
   */
  private scheduleBannerRemoval(): void {
    window.clearTimeout(this.quietTimer);
    this.quietTimer = window.setTimeout(() => {
      if (!this.open) return;
      this.banner?.remove();
      this.banner = null;
    }, REPLAY_QUIET_MS);
  }
}
