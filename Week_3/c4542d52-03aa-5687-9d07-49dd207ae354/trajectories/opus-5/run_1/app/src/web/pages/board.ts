import type { BoardQueue, BoardQueueEntry, LiveEvent } from "../../shared/types.js";
import { formatCount, formatDate, formatPricePerShare, vestingLabel } from "../../shared/format.js";
import { api, ApiFailure } from "../api.js";
import { announce, applySocketState, navigate, notFoundPage, type Page, type PageContext } from "../app.js";
import { clear, el, liveButton } from "../dom.js";

let returningTo: string | null = null;

async function vote(grantId: string, choice: "approve" | "decline", after: () => Promise<void>): Promise<void> {
  try {
    const result = await api<{ approvals: number }>(`/api/board/queue/${grantId}/votes`, {
      method: "POST",
      body: { vote: choice },
    });
    const queue = await api<BoardQueue>("/api/board/queue");
    announce(
      choice === "approve"
        ? `Your approval of ${grantId} is recorded: ${result.approvals} of ${queue.quorum} approvals.`
        : `Your decline of ${grantId} is recorded.`,
    );
    await after();
  } catch (failure) {
    if (!(failure instanceof ApiFailure)) throw failure;
    announce(failure.message);
    await after();
  }
}

export function boardQueuePage(context: PageContext): Page {
  async function draw(): Promise<void> {
    const queue = await api<BoardQueue>("/api/board/queue");
    clear(context.main);
    if (queue.grants.length === 0) {
      context.main.append(
        el("section", { class: "band band-ink full" }, [el("p", {}, ["Nothing is waiting for your vote."])]),
      );
      return;
    }
    const rows = queue.grants.map((entry) => {
      const approve = liveButton(`Approve ${entry.id}`);
      approve.addEventListener("click", () => void vote(entry.id, "approve", draw));
      const decline = liveButton(`Decline ${entry.id}`);
      decline.addEventListener("click", () => void vote(entry.id, "decline", draw));
      return el("tr", {}, [
        el("td", {}, [el("a", { href: `/board/${entry.id}`, "data-route": "", "data-grant": entry.id }, [entry.id])]),
        el("td", {}, [entry.holder_name]),
        el("td", {}, [formatCount(entry.options)]),
        el("td", {}, [`${entry.approvals} of ${queue.quorum} approvals`]),
        el("td", {}, [approve, decline]),
      ]);
    });
    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, [`Quorum ${queue.quorum} of ${queue.board_size}`]),
        el("div", { class: "column" }, [
          el("h1", { class: "chapter-title" }, ["Board queue"]),
          el("table", { class: "ledger-table", "aria-label": "Board queue" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { scope: "col" }, ["Grant"]),
                el("th", { scope: "col" }, ["Holder"]),
                el("th", { scope: "col" }, ["Options"]),
                el("th", { scope: "col" }, ["Approvals"]),
                el("th", { scope: "col" }, ["Vote"]),
              ]),
            ]),
            el("tbody", {}, rows),
          ]),
        ]),
      ]),
    );
    applySocketState();
    if (returningTo !== null) {
      const link = document.querySelector<HTMLElement>(`[data-grant="${returningTo}"]`);
      returningTo = null;
      if (link !== null) link.focus();
    }
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "grant_changed") void draw();
    },
  };
}

export function boardGrantPage(context: PageContext): Page {
  const grantId = context.params["id"] ?? "";
  let missing = false;

  function back(): void {
    returningTo = grantId;
    navigate("/board");
  }

  async function draw(): Promise<void> {
    const queue = await api<BoardQueue>("/api/board/queue");
    const entry: BoardQueueEntry | undefined = queue.grants.find((candidate) => candidate.id === grantId);
    clear(context.main);
    if (entry === undefined) {
      missing = true;
      await notFoundPage(context).render();
      return;
    }
    missing = false;
    const approve = liveButton(`Approve ${entry.id}`, { class: "primary" });
    approve.addEventListener("click", () => void vote(entry.id, "approve", draw));
    const decline = liveButton(`Decline ${entry.id}`);
    decline.addEventListener("click", () => void vote(entry.id, "decline", draw));
    const backLink = el("a", { href: "/board", class: "back-link" }, ["Back to the queue"]);
    backLink.addEventListener("click", (event) => {
      event.preventDefault();
      back();
    });

    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, [entry.id]),
        el("section", { class: "column", role: "region", "aria-label": "Grant summary" }, [
          el("h1", { class: "chapter-title", id: "summary-heading", tabindex: "-1" }, [entry.id]),
          el("div", { class: "labelled" }, [
            el("span", { class: "labelled-label" }, ["Holder"]),
            el("span", { class: "labelled-value" }, [entry.holder_name]),
          ]),
          el("div", { class: "labelled" }, [
            el("span", { class: "labelled-label" }, ["Options"]),
            el("span", { class: "labelled-value" }, [formatCount(entry.options)]),
          ]),
          el("div", { class: "labelled" }, [
            el("span", { class: "labelled-label" }, ["Strike price"]),
            el("span", { class: "labelled-value" }, [formatPricePerShare(entry.strike)]),
          ]),
          el("div", { class: "labelled" }, [
            el("span", { class: "labelled-label" }, ["Vesting"]),
            el("span", { class: "labelled-value" }, [
              `${vestingLabel(entry.vesting_type)}, from ${formatDate(entry.vesting_start)}`,
            ]),
          ]),
          el("p", { class: "approvals" }, [`${entry.approvals} of ${queue.quorum} approvals`]),
          el("div", { class: "actions" }, [approve, decline]),
          backLink,
        ]),
      ]),
    );
    applySocketState();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !missing) {
      event.preventDefault();
      back();
    }
  }

  return {
    async render(): Promise<void> {
      await draw();
      document.addEventListener("keydown", onKeyDown);
      const heading = document.getElementById("summary-heading");
      if (heading !== null) heading.focus();
    },
    onEvent(event: LiveEvent): void {
      if (event.type === "grant_changed") void draw();
    },
    destroy(): void {
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}
