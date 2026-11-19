import { api, ApiError } from "./api";
import { clear, h, randomId } from "./dom";
import { openDialog, type DialogHandle } from "./dialogs";
import { Fuse } from "./fuse";
import { closeButton, failureCopy, heading } from "./panels";
import { notify } from "./state";
import type { RoomState, ShopItem } from "./types";

const PURCHASE_ERRORS: Record<string, string> = {
  shop_closed: "The ammo station is closed until the next intermission.",
  at_capacity: "You're carrying as many as you can.",
};

/** The Ammo station drawer: current prices, pending price countdowns and buy buttons. */
export class ShopDrawer {
  private readonly handle: DialogHandle;
  private readonly list = h("ul", { class: "shop-list" });
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly fuses = new Map<string, Fuse>();
  private readonly pending = new Set<string>();
  private signature = "";

  constructor(private readonly code: string, opener: HTMLElement | null, state: RoomState, onClose: () => void) {
    this.handle = openDialog({
      name: "Ammo station", drawer: true, opener, onClose: () => { this.fuses.forEach((f) => f.destroy()); onClose(); },
      content: [heading("Ammo station"), this.list, h("div", { class: "row-end" }, closeButton(() => this.handle.close()))],
      initialFocus: () => this.buttons.values().next().value ?? null,
    });
    this.update(state);
    this.buttons.values().next().value?.focus();
  }

  close(): void {
    this.handle.close();
  }

  update(state: RoomState): void {
    const items = state.shop.items;
    const signature = items.map((i) => `${i.item}:${i.price}:${i.next_price}`).join("|");
    if (signature !== this.signature) {
      this.signature = signature;
      this.render(items);
    }
    for (const item of items) this.fuses.get(item.item)?.set(item.next_change_in_ms);
  }

  private render(items: ShopItem[]): void {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.getAttribute("data-item") : null;
    clear(this.list);
    this.buttons.clear();
    this.fuses.forEach((f) => f.destroy());
    this.fuses.clear();
    for (const item of items) {
      const button = h("button", { type: "button", class: "btn btn-primary", "data-item": item.item, disabled: this.pending.has(item.item) },
        `Buy ${item.name} — ${item.price} cr`);
      button.addEventListener("click", () => void this.buy(item, button));
      this.buttons.set(item.item, button);
      const row = h("li", { class: "shop-row" }, h("span", { class: "shop-name" }, item.name), button);
      if (item.next_price !== null && item.next_change_in_ms !== null) {
        const fuse = new Fuse({ name: `Price change ${item.name}`, outcome: "new price", onResolve: () => notify(`Price change ${item.name} — new price`) });
        this.fuses.set(item.item, fuse);
        row.append(h("span", { class: "shop-next" }, h("span", { class: "cap" }, `${item.next_price} cr in `), fuse.el));
        fuse.set(item.next_change_in_ms);
      }
      this.list.append(row);
    }
    if (focused) this.buttons.get(focused)?.focus();
  }

  private async buy(item: ShopItem, button: HTMLButtonElement): Promise<void> {
    this.pending.add(item.item);
    button.disabled = true;
    notify(`Buying ${item.name}…`);
    try {
      await api("POST", `/api/rooms/${this.code}/purchases`, { purchase_id: randomId(), item: item.item });
      notify(`Bought ${item.name} for ${item.price} cr.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "insufficient_credits") notify(`Not enough credits — ${item.name} costs ${item.price} cr.`);
      else notify(error instanceof ApiError && PURCHASE_ERRORS[error.code] ? PURCHASE_ERRORS[error.code] : failureCopy(error));
    }
    this.pending.delete(item.item);
    const live = this.buttons.get(item.item);
    if (live) {
      live.disabled = false;
      if (!document.activeElement || document.activeElement === document.body) live.focus();
    }
  }
}
