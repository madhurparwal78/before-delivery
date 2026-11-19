const FLUSH_MS = 80;

/** The notice kinds that say the same thing as a derived lot sentence. */
const SUPERSEDES_PRICE = new Set(["outbid"]);
const SUPERSEDES_CLOSE = new Set(["won", "lot_closed"]);

/**
 * Announcer speaks into the page's hidden polite status region. Each event is
 * announced once, in the published words. When a notice and a derived
 * sentence would say the same thing, only the notice is announced.
 */
export class Announcer {
  private readonly region: HTMLElement;
  private price: string | null = null;
  private reserve: string | null = null;
  private close: string | null = null;
  private notices: string[] = [];
  private noticeKinds = new Set<string>();
  private results: string[] = [];
  private timer = 0;
  private spoken = new Set<string>();

  constructor(region: HTMLElement) {
    this.region = region;
  }

  /** priceChanged queues the price sentence for the lot on screen. */
  priceChanged(sentence: string): void {
    this.price = sentence;
    this.schedule();
  }

  /** reserveMet queues the reserve sentence, which follows the price. */
  reserveMet(sentence: string): void {
    this.reserve = sentence;
    this.schedule();
  }

  /** lotClosed queues the close sentence for the lot on screen. */
  lotClosed(sentence: string): void {
    this.close = sentence;
    this.schedule();
  }

  /** notice queues one arriving notice, announced as its exact text. */
  notice(id: string, kind: string, text: string): void {
    if (this.spoken.has(id)) return;
    this.spoken.add(id);
    this.notices.push(text);
    this.noticeKinds.add(kind);
    this.schedule();
  }

  /** result queues the outcome of something the person has just done. */
  result(sentence: string): void {
    this.results.push(sentence);
    this.schedule();
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush(): void {
    const parts: string[] = [...this.results, ...this.notices];
    const noticeTookPrice = [...this.noticeKinds].some((kind) => SUPERSEDES_PRICE.has(kind));
    const noticeTookClose = [...this.noticeKinds].some((kind) => SUPERSEDES_CLOSE.has(kind));
    if (this.price && !noticeTookPrice) parts.push(this.price);
    if (this.reserve) parts.push(this.reserve);
    if (this.close && !noticeTookClose) parts.push(this.close);
    this.results = [];
    this.notices = [];
    this.noticeKinds = new Set();
    this.price = null;
    this.reserve = null;
    this.close = null;
    if (parts.length === 0) return;
    this.region.textContent = parts.join(" ");
  }
}
