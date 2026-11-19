import { fmtCoins } from "../format";

interface HeldPush {
  readonly balance: number;
  readonly purchaseId: string | null;
}

// The Coin balance region and the balance the tab knows. The visible balance changes only from a
// confirmed purchase, a garage read or an applied push. While a purchase is pending or unconfirmed,
// pushes are held; across a sweep the visible balance waits for the sweep's balance step.
export class BalanceView {
  private visible: number;
  private known: number;
  private pending = false;
  private sweeping = false;
  private held: HeldPush[] = [];
  private awaitingPurchase: string | null = null;
  private newer: number | null = null;
  private readonly watchers = new Set<(balance: number) => void>();

  constructor(private readonly region: HTMLElement, balance: number) {
    this.visible = balance;
    this.known = balance;
    this.paint();
  }

  private paint(): void {
    this.region.textContent = `${fmtCoins(this.visible)} coins`;
  }

  show(value: number): void {
    this.visible = value;
    this.paint();
  }

  get shown(): number {
    return this.visible;
  }

  get latest(): number {
    return this.known;
  }

  watch(watcher: (balance: number) => void): () => void {
    this.watchers.add(watcher);
    return () => { this.watchers.delete(watcher); };
  }

  private learn(balance: number): void {
    this.known = balance;
    for (const watcher of this.watchers) watcher(balance);
  }

  push(balance: number, purchaseId: string | null): void {
    if (this.awaitingPurchase) {
      // Pushes from before this purchase's own push are older movements: the response already counts them.
      if (purchaseId === this.awaitingPurchase) this.awaitingPurchase = null;
      return;
    }
    this.learn(balance);
    if (this.pending) this.held.push({ balance, purchaseId });
    else if (this.sweeping) this.newer = balance;
    else this.show(balance);
  }

  read(balance: number): void {
    this.learn(balance);
    if (this.pending || this.sweeping) this.newer = balance;
    else this.show(balance);
  }

  setPending(pending: boolean): void {
    this.pending = pending;
    if (!pending && this.held.length && !this.sweeping) {
      this.show(this.held[this.held.length - 1].balance);
      this.held = [];
    }
  }

  // A confirmed upgrade: holds the visible balance until the sweep's balance step.
  beginSweep(purchaseId: string, balance: number): void {
    const own = this.held.findIndex((push) => push.purchaseId === purchaseId);
    const later = own >= 0 ? this.held.slice(own + 1) : [];
    this.newer = later.length ? later[later.length - 1].balance : null;
    this.awaitingPurchase = own >= 0 ? null : purchaseId;
    this.held = [];
    this.pending = false;
    this.sweeping = true;
    this.learn(this.newer ?? balance);
  }

  // The sweep's balance step has finished: pushes for later movements apply now.
  endSweep(balance: number): void {
    this.sweeping = false;
    this.show(this.newer ?? balance);
    this.newer = null;
  }
}
