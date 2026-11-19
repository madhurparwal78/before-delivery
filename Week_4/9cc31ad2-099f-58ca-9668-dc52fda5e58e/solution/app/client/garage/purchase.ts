import { call, NoResponse } from "../api";
import { fmtCoins } from "../format";
import { h } from "../dom";
import { openDialog } from "../ui/dialog";

const UNCONFIRMED = "We couldn't confirm the purchase. Nothing changes here until it is confirmed.";
const NO_ANSWER_MS = 10000;

type Outcome<T> =
  | { kind: "confirmed"; data: T }
  | { kind: "insufficient" }
  | { kind: "other"; status: number }
  | { kind: "unconfirmed" };

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// One purchase attempt: from the first press of Buy to its first HTTP response (or the dialog
// closing). Every request of the attempt carries the same Idempotency-Key and byte-identical body;
// once it has ended its key is never sent again.
export class PurchaseAttempt<T> {
  private readonly key = newKey();
  private readonly body: string;

  constructor(private readonly path: string, payload: unknown) {
    this.body = JSON.stringify(payload);
  }

  async send(): Promise<Outcome<T>> {
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), NO_ANSWER_MS);
    try {
      const result = await call<T>("POST", this.path, { body: this.body, key: this.key, signal: abort.signal });
      if (result.status === 201) return { kind: "confirmed", data: result.data };
      if (result.status === 402) return { kind: "insufficient" };
      return { kind: "other", status: result.status };
    } catch (error) {
      if (error instanceof NoResponse) return { kind: "unconfirmed" };
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }
}

type DialogState = "buy" | "pending" | "insufficient" | "unconfirmed";

interface PurchaseDialogOptions<T> {
  readonly title: string;
  readonly price: number;
  readonly path: string;
  readonly payload: unknown;
  readonly details: () => Node[];
  readonly knownBalance: () => number;
  readonly opener: () => HTMLElement | null;
  // Held balance pushes stay held while the dialog is pending or unconfirmed.
  readonly onPending: (pending: boolean) => void;
  readonly onConfirmed: (data: T) => void;
  // 402: re-read the garage; resolves with the latest balance.
  readonly onInsufficient: () => Promise<number>;
  // Any other answer, or closing while unconfirmed: re-read, announce, place focus.
  readonly onRefresh: () => void;
  readonly onClose: () => void;
}

// Confirm upgrade and Confirm car purchase: buy, not-enough-coins, pending and unconfirmed states,
// following the live balance while it is neither pending nor unconfirmed.
export class PurchaseDialog<T> {
  private state: DialogState = "buy";
  private attempt: PurchaseAttempt<T> | null = null;
  private readonly handle: ReturnType<typeof openDialog>;
  private readonly buy: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly buyLabel: string;
  private closed = false;

  constructor(private readonly options: PurchaseDialogOptions<T>) {
    this.buyLabel = `Buy for ${fmtCoins(options.price)} coins`;
    this.buy = h("button", { type: "button", class: "primary", onclick: () => void this.press() }, this.buyLabel);
    this.cancel = h("button", { type: "button", onclick: () => this.dismiss() }, "Cancel");
    this.status = h("div", { class: "dialog-state" });
    const short = options.knownBalance() < options.price;
    this.handle = openDialog({
      title: options.title,
      body: [...options.details(), this.status],
      actions: [this.buy, this.cancel],
      onEscape: () => this.dismiss(),
      initialFocus: short ? this.cancel : this.buy,
    });
    if (short) this.showInsufficient(options.knownBalance(), true);
  }

  get open(): boolean {
    return !this.closed;
  }

  // Every balance the tab learns of re-evaluates the dialog while it waits for a press.
  balanceChanged(balance: number): void {
    if (this.closed || this.state === "pending" || this.state === "unconfirmed") return;
    if (balance < this.options.price) this.showInsufficient(balance, this.state !== "insufficient");
    else if (this.state === "insufficient") this.showBuy();
  }

  private showBuy(): void {
    this.state = "buy";
    this.status.replaceChildren();
    this.buy.disabled = false;
    this.buy.textContent = this.buyLabel;
  }

  private showInsufficient(balance: number, moveFocus: boolean): void {
    this.state = "insufficient";
    this.status.replaceChildren(
      h("h3", { class: "dialog-error" }, "Not enough coins"),
      h("p", null, `You need ${fmtCoins(this.options.price - balance)} more coins.`));
    this.buy.disabled = true;
    this.buy.textContent = this.buyLabel;
    if (moveFocus) this.cancel.focus();
  }

  private showUnconfirmed(): void {
    this.state = "unconfirmed";
    this.status.replaceChildren(h("p", { class: "dialog-error" }, UNCONFIRMED));
    this.buy.disabled = false;
    this.buy.textContent = "Check again";
    this.buy.focus();
  }

  private async press(): Promise<void> {
    if (this.state === "buy") this.attempt = new PurchaseAttempt<T>(this.options.path, this.options.payload);
    else if (this.state !== "unconfirmed") return;
    const attempt = this.attempt!;
    this.state = "pending";
    this.options.onPending(true);
    this.buy.disabled = true;
    this.buy.textContent = "Buying…";
    const outcome = await attempt.send();
    if (this.closed) return;
    if (outcome.kind === "unconfirmed") {
      this.showUnconfirmed();
      return;
    }
    if (outcome.kind === "confirmed") {
      // onConfirmed ends the pending state itself, so held pushes can wait for the sweep.
      this.close();
      this.options.onConfirmed(outcome.data);
      return;
    }
    this.options.onPending(false);
    if (outcome.kind === "insufficient") {
      const balance = await this.options.onInsufficient();
      if (!this.closed) this.showInsufficient(balance, true);
    } else {
      this.close();
      this.options.onRefresh();
    }
  }

  private dismiss(): void {
    const wasWaiting = this.state === "unconfirmed" || this.state === "pending";
    this.attempt = null;
    this.close();
    if (wasWaiting) {
      this.options.onPending(false);
      this.options.onRefresh();
    } else {
      this.options.opener()?.focus();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.handle.close();
    this.options.onClose();
  }
}
