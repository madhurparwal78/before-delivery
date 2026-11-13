import type { LiveEvent, Tender } from "../../shared/types.js";
import { formatCount, formatCountdown, formatInstant, formatMoney, formatPricePerShare } from "../../shared/format.js";
import { api, ApiFailure } from "../api.js";
import { announce, applySocketState, signedInAs, type Page, type PageContext } from "../app.js";
import { clear, el, liveButton } from "../dom.js";
import { serverNow } from "../live.js";
import { countTo } from "../ui/motion.js";

export function tenderPage(context: PageContext): Page {
  let tender: Tender | null = null;
  let countdownNode: HTMLElement | null = null;
  let allocationShown = 0;

  async function loadTender(): Promise<Tender | null> {
    const id = context.params["id"];
    if (id !== undefined) return api<Tender>(`/api/tenders/${id}`);
    const result = await api<{ tenders: Tender[] }>("/api/tenders");
    return result.tenders[0] ?? null;
  }

  async function act(run: () => Promise<unknown>, success: string): Promise<void> {
    try {
      await run();
      await draw();
      announce(success);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      await draw();
      announce(failure.message);
    }
  }

  async function draw(): Promise<void> {
    const me = signedInAs();
    const loaded = await loadTender();
    tender = loaded;
    clear(context.main);
    context.main.append(el("section", { class: "band band-ink chapter-band" }, [el("h1", {}, ["Tender"])]));
    if (loaded === null) {
      context.main.append(el("section", { class: "band band-ink full" }, [el("p", {}, ["No tender is open."])]));
      return;
    }
    const now = serverNow();
    const remaining = new Date(loaded.closes_at).getTime() - now.getTime();
    const closed = loaded.state !== "open" || remaining <= 0;
    countdownNode = el("span", { role: "timer", "aria-label": "Tender closes in" }, [
      closed ? "Closed" : formatCountdown(remaining),
    ]);

    const column = el("div", { class: "column" }, [
      el("h2", { class: "chapter-title" }, [loaded.title]),
      countdownNode,
      el("div", { class: "labelled" }, [
        el("span", { class: "labelled-label" }, ["Price per share"]),
        el("span", { class: "labelled-value" }, [formatPricePerShare(loaded.price_per_share)]),
      ]),
      el("div", { class: "labelled" }, [
        el("span", { class: "labelled-label" }, ["Share cap"]),
        el("span", { class: "labelled-value" }, [formatCount(loaded.share_cap)]),
      ]),
      el("div", { class: "labelled" }, [
        el("span", { class: "labelled-label" }, ["Remaining cap"]),
        el("span", { class: "labelled-value" }, [formatCount(loaded.remaining_cap)]),
      ]),
    ]);
    if (loaded.oversubscribed_by > 0) {
      column.append(
        el("div", { class: "labelled" }, [
          el("span", { class: "labelled-label" }, ["Oversubscribed by"]),
          el("span", { class: "labelled-value" }, [formatCount(loaded.oversubscribed_by)]),
        ]),
      );
    }

    const mine = loaded.mine;
    if (me.role === "investor" && mine !== undefined) {
      if (mine.nda.status !== "sealed") {
        const sign = liveButton("Sign NDA", { class: "primary" });
        sign.addEventListener("click", () => {
          announce("Sealing your NDA in the vault.");
          void act(() => api(`/api/tenders/${loaded.id}/nda`, { method: "POST", body: {} }), "NDA signed and sealed.");
        });
        column.append(sign);
        if (mine.nda.status === "pending") {
          const retry = liveButton("Retry signing");
          retry.addEventListener("click", () => {
            void act(() => api(`/api/tenders/${loaded.id}/nda`, { method: "POST", body: {} }), "NDA signed and sealed.");
          });
          column.append(
            el("section", { class: "band band-red" }, [
              el("p", {}, ["The document vault can't be reached. Your NDA is pending and you can't tender yet."]),
              retry,
            ]),
          );
        }
      }

      const sharesInput = el("input", {
        type: "text",
        id: "tender-shares",
        inputmode: "numeric",
        value: mine.submission === null ? mine.draft_shares ?? "" : String(mine.submission.shares),
        readonly: mine.submission !== null,
      }) as HTMLInputElement;
      const error = el("p", { class: "field-error", hidden: true });
      let draftTimer: number | null = null;
      sharesInput.addEventListener("input", () => {
        if (draftTimer !== null) window.clearTimeout(draftTimer);
        draftTimer = window.setTimeout(() => {
          void api(`/api/tenders/${loaded.id}/draft`, {
            method: "PUT",
            body: { shares: sharesInput.value.slice(0, 12) },
          }).catch(() => undefined);
        }, 400);
      });

      const submit = liveButton("Submit tender", { class: "primary" });
      submit.addEventListener("click", () => {
        submit.textContent = "Submitting";
        void (async () => {
          try {
            await api(`/api/tenders/${loaded.id}/submissions`, {
              method: "POST",
              body: { shares: Number(sharesInput.value.replace(/[^\d]/g, "")) },
            });
            await draw();
            announce(
              `Tender submitted: ${formatCount(Number(sharesInput.value.replace(/[^\d]/g, "")))} shares at ${formatPricePerShare(loaded.price_per_share)}.`,
            );
          } catch (failure) {
            if (!(failure instanceof ApiFailure)) throw failure;
            submit.textContent = "Submit tender";
            const message = failure.fields["shares"] ?? failure.message;
            error.hidden = false;
            error.textContent = `Error: ${message}`;
            announce(message);
          }
        })();
      });
      if (mine.nda.status !== "sealed") {
        submit.setAttribute("aria-disabled", "true");
        submit.disabled = true;
        column.append(el("p", { class: "side-note" }, ["Sign the NDA to tender"]));
      }

      column.append(
        el("div", { class: "field" }, [el("label", { for: "tender-shares" }, ["Shares to tender"]), sharesInput, error]),
      );
      if (mine.submission === null) column.append(submit);
      else {
        const withdraw = liveButton("Withdraw tender");
        withdraw.addEventListener("click", () => {
          void act(
            () => api(`/api/tenders/${loaded.id}/submissions/mine`, { method: "DELETE" }),
            "Tender withdrawn.",
          );
        });
        column.append(withdraw);
      }

      const allocationRegion = el("section", { class: "allocation", role: "region", "aria-label": "Your allocation" });
      if (mine.allocation !== null && mine.proceeds !== null) {
        const figure = el("span", { class: "display-figure" }, ["0"]);
        allocationRegion.append(
          el("p", {}, ["Allocated ", figure, ` shares, proceeds ${formatMoney(mine.proceeds)}`]),
        );
        const target = mine.allocation;
        countTo(figure, allocationShown, target, (value) => formatCount(value));
        allocationShown = target;
      } else {
        allocationRegion.append(el("p", {}, [`Projected allocation ${formatCount(mine.projected_allocation)}`]));
      }
      column.append(allocationRegion);
    }

    if (me.role === "founder_admin" && loaded.submissions !== undefined) {
      const rows = loaded.submissions.map((submission) =>
        el("tr", {}, [
          el("td", {}, [submission.holder_name]),
          el("td", {}, [formatCount(submission.shares)]),
          el("td", {}, [formatInstant(submission.submitted_at)]),
          el("td", {}, [submission.allocation === null ? "" : formatCount(submission.allocation)]),
          el("td", {}, [submission.proceeds === null ? "" : formatMoney(submission.proceeds)]),
        ]),
      );
      column.append(
        el("table", { class: "ledger-table", "aria-label": "Tender submissions" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { scope: "col" }, ["Holder"]),
              el("th", { scope: "col" }, ["Shares"]),
              el("th", { scope: "col" }, ["Submitted"]),
              el("th", { scope: "col" }, ["Allocation"]),
              el("th", { scope: "col" }, ["Proceeds"]),
            ]),
          ]),
          el("tbody", {}, rows),
        ]),
      );
    }

    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, [`Bought by ${loaded.buyer}`]),
        column,
      ]),
    );
    applySocketState();
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "clock") {
        if (countdownNode !== null && tender !== null) {
          const remaining = new Date(tender.closes_at).getTime() - serverNow().getTime();
          countdownNode.textContent = tender.state !== "open" || remaining <= 0 ? "Closed" : formatCountdown(remaining);
        }
        return;
      }
      if (event.type === "tender_changed" || event.type === "tender_closed" || event.type === "tender_allocated") {
        void draw();
      }
    },
  };
}
