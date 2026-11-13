import type { LiveEvent, Order } from "../../shared/types.js";
import { formatCount, formatInstant, formatMoney } from "../../shared/format.js";
import { api, ApiFailure } from "../api.js";
import { announce, applySocketState, type Page, type PageContext } from "../app.js";
import { clear, el, liveButton } from "../dom.js";
import { ORDER_STATE_WORDS } from "../labels.js";

export function exerciseChapterPage(context: PageContext): Page {
  async function draw(): Promise<void> {
    const result = await api<{ orders: Order[] }>("/api/exercises");
    clear(context.main);
    context.main.append(
      el("section", { class: "band band-ink chapter-band" }, [el("h1", {}, ["Exercise"])]),
    );
    if (result.orders.length === 0) {
      context.main.append(
        el("section", { class: "band band-ink full" }, [el("p", {}, ["No exercise orders yet."])]),
      );
      return;
    }
    const rows = result.orders.map((order) =>
      el("li", {}, [
        el("a", { href: `/exercises/${order.id}`, "data-route": "" }, [order.id]),
        el("span", { class: "order-state" }, [ORDER_STATE_WORDS[order.state]]),
        el("span", { class: "order-cost" }, [formatMoney(order.cost)]),
        el("span", { class: "order-options" }, [`${formatCount(order.options)} options`]),
      ]),
    );
    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, ["Your orders, newest first."]),
        el("ul", { class: "column order-list" }, rows),
      ]),
    );
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "order_changed") void draw();
    },
  };
}

export function orderPage(context: PageContext): Page {
  const orderId = context.params["id"] ?? "";

  async function act(path: string, success: string): Promise<void> {
    try {
      await api<Order>(path, { method: "POST", body: {} });
      await draw();
      announce(success);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      await draw();
      announce(failure.message);
    }
  }

  async function draw(): Promise<void> {
    const order = await api<Order>(`/api/exercises/${orderId}`);
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.id : null;
    clear(context.main);
    const column = el("div", { class: "column" }, [
      el("h1", { class: "chapter-title", tabindex: "-1", id: "order-heading" }, [order.id]),
      el("p", { class: "state-word" }, [ORDER_STATE_WORDS[order.state]]),
      el("div", { class: "labelled" }, [
        el("span", { class: "labelled-label" }, ["Options"]),
        el("span", { class: "labelled-value" }, [formatCount(order.options)]),
      ]),
      el("div", { class: "labelled" }, [
        el("span", { class: "labelled-label" }, ["Strike price"]),
        el("span", { class: "labelled-value" }, [`$${order.strike}`]),
      ]),
      el("div", { class: "labelled" }, [
        el("span", { class: "labelled-label" }, ["Cost"]),
        el("span", { class: "labelled-value" }, [formatMoney(order.cost)]),
      ]),
    ]);

    if (order.payment !== null) {
      column.append(
        el("section", { class: "provider-record", role: "region", "aria-label": "Provider record" }, [
          el("p", {}, [`Reference ${order.payment.id}`]),
          el("p", {}, [`Amount ${formatMoney(order.cost)} USD`]),
          el("p", {}, [
            order.payment.confirmed_at === null
              ? "Confirmed —"
              : `Confirmed ${formatInstant(order.payment.confirmed_at)}`,
          ]),
        ]),
      );
    }

    const actions: HTMLElement[] = [];
    if (order.state === "held") {
      const retry = liveButton("Retry payment", { class: "primary", id: "retry-payment" });
      retry.addEventListener("click", () => void act(`/api/exercises/${order.id}/retry`, `Order ${order.id} retried.`));
      column.append(
        el("section", { class: "band band-red" }, [
          el("p", {}, [
            `The payment provider can't be reached. Order ${order.id} is held under key ${order.idempotency_key}. Nothing has been issued.`,
          ]),
        ]),
      );
      actions.push(retry);
    }
    if (order.notice !== null && order.notice.status === "pending") {
      const retryNotice = liveButton("Retry notice", { id: "retry-notice" });
      retryNotice.addEventListener("click", () =>
        void act(`/api/exercises/${order.id}/retry`, `Exercise notice for ${order.id} sealed in the vault.`),
      );
      column.append(
        el("section", { class: "band band-red" }, [
          el("p", {}, [
            `The document vault can't be reached. The exercise notice for ${order.id} is pending; your shares are issued.`,
          ]),
        ]),
      );
      actions.push(retryNotice);
    }
    if (order.notice !== null && order.notice.status === "sealed") {
      column.append(
        el("p", { class: "notice-status" }, [
          "Exercise notice sealed: ",
          el("a", { href: `/documents/${order.notice.document_id}`, "data-route": "" }, [order.notice.document_id]),
        ]),
      );
    }
    if (order.state === "pending" || order.state === "held") {
      const cancel = liveButton("Cancel order", { id: "cancel-order" });
      cancel.addEventListener("click", () =>
        void act(`/api/exercises/${order.id}/cancel`, `Order ${order.id} cancelled. No shares were issued.`),
      );
      actions.push(cancel);
    }
    if (actions.length > 0) column.append(el("div", { class: "actions" }, actions));

    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("div", { class: "side" }, [el("p", { class: "side-note" }, [order.grant_id])]),
        column,
      ]),
    );
    applySocketState();
    if (focused !== null) {
      const again = document.getElementById(focused);
      if (again !== null) again.focus();
    }
  }

  return {
    async render(): Promise<void> {
      await draw();
      const heading = document.getElementById("order-heading");
      if (heading !== null) heading.focus();
    },
    onEvent(event: LiveEvent): void {
      if (event.type === "order_changed" && event.data["order_id"] === orderId) void draw();
    },
  };
}
