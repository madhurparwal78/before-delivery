import type { Grant, LiveEvent, Order } from "../../shared/types.js";
import { grantAgreementText } from "../../shared/documents.js";
import { formatCount, formatCountdown, formatDate, formatMoney } from "../../shared/format.js";
import { api, ApiFailure } from "../api.js";
import { announce, applySocketState, navigate, signedInAs, type Page, type PageContext } from "../app.js";
import { clear, el, liveButton } from "../dom.js";
import { GRANT_STATE_WORDS } from "../labels.js";
import { serverNow } from "../live.js";
import { openDialog } from "../ui/dialog.js";
import { buildRibbon, cellIndexForMark, serverMark, type RibbonView } from "../ui/ribbon.js";
import { countMoney, countTo, scrollCellIntoTrack } from "../ui/motion.js";
import { offerWarningStrip, windowWarningStrip } from "../warnings.js";

export function grantPage(context: PageContext): Page {
  let grant: Grant | null = null;
  let ribbon: RibbonView | null = null;
  let marker = 0;
  let slider: HTMLElement | null = null;
  let vestedNode: HTMLElement | null = null;
  let costNode: HTMLElement | null = null;
  let ownershipNode: HTMLElement | null = null;
  let countdownNode: HTMLElement | null = null;
  let signaturePending = false;

  const grantId = context.params["id"] ?? "";

  function markerValueText(): string {
    if (grant === null) return "";
    const tranche = grant.schedule[marker];
    const date = tranche === undefined ? "" : formatDate(tranche.date);
    return marker === serverMark(grant) ? `${date} (today)` : date;
  }

  function paintFigures(previous: number): void {
    if (grant === null) return;
    const tranche = grant.schedule[marker];
    if (tranche === undefined) return;
    const previousTranche = grant.schedule[previous];
    if (vestedNode !== null) {
      countTo(vestedNode, previousTranche?.cumulative ?? tranche.cumulative, tranche.cumulative, (value) =>
        formatCount(value),
      );
    }
    if (costNode !== null) {
      countMoney(costNode, previousTranche?.cost_at_strike ?? tranche.cost_at_strike, tranche.cost_at_strike, (value) =>
        formatMoney(value),
      );
    }
    if (ownershipNode !== null) ownershipNode.textContent = `${tranche.vested_ownership}%`;
  }

  function setMarker(next: number): void {
    if (grant === null || ribbon === null || slider === null) return;
    const previous = marker;
    marker = Math.min(48, Math.max(0, next));
    slider.setAttribute("aria-valuenow", String(marker));
    slider.setAttribute("aria-valuetext", markerValueText());
    ribbon.paint(marker);
    paintFigures(previous);
    const index = cellIndexForMark(ribbon.cells, marker);
    const node = ribbon.nodes[index];
    if (node !== undefined) {
      for (const other of ribbon.nodes) other.classList.remove("is-marker");
      node.classList.add("is-marker");
      scrollCellIntoTrack(ribbon.track, node);
    }
  }

  async function load(): Promise<Grant> {
    const loaded = await api<Grant>(`/api/grants/${grantId}`);
    grant = loaded;
    return loaded;
  }

  function openExerciseDialog(): void {
    if (grant === null) return;
    const current = grant;
    const input = el("input", { type: "text", id: "exercise-options", inputmode: "numeric" }) as HTMLInputElement;
    const cost = el("span", { class: "labelled-value", id: "exercise-cost" }, ["$0.00"]);
    const error = el("p", { class: "field-error", hidden: true });
    const confirm = liveButton("Confirm exercise", { class: "primary" });
    const close = el("button", { type: "button" }, ["Close"]) as HTMLButtonElement;
    const dialog = el("dialog", { class: "dialog", "aria-label": "Exercise options" }, [
      el("h2", {}, ["Exercise options"]),
      el("div", { class: "field" }, [el("label", { for: "exercise-options" }, ["Options to exercise"]), input, error]),
      el("div", { class: "labelled" }, [el("span", { class: "labelled-label" }, ["Cost"]), cost]),
      el("div", { class: "dialog-actions" }, [confirm, close]),
    ]) as HTMLDialogElement;

    const handle = openDialog(dialog, "[data-exercise-open]", { initialFocus: input });
    close.addEventListener("click", () => handle.close());

    let timer: number | null = null;
    input.addEventListener("input", () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const options = Number(input.value.replace(/[^\d]/g, ""));
        if (!Number.isInteger(options) || options < 1) {
          cost.textContent = "$0.00";
          return;
        }
        void api<{ cost: string }>(`/api/grants/${current.id}/exercise-quote`, {
          method: "POST",
          body: { options },
        })
          .then((quote) => {
            cost.textContent = formatMoney(quote.cost);
          })
          .catch(() => {
            cost.textContent = "$0.00";
          });
      }, 300);
    });

    async function place(): Promise<void> {
      const options = Number(input.value.replace(/[^\d]/g, ""));
      error.hidden = true;
      confirm.textContent = "Sending to the provider";
      confirm.disabled = true;
      try {
        const order = await api<Order>(`/api/grants/${current.id}/exercises`, {
          method: "POST",
          body: { options },
          headers: { "Idempotency-Key": crypto.randomUUID().replace(/-/g, "") },
        });
        handle.close();
        if (order.state === "pending") announce("Payment pending at the provider. Your shares appear once it confirms.");
        navigate(`/exercises/${order.id}`);
      } catch (failure) {
        confirm.textContent = "Confirm exercise";
        confirm.disabled = false;
        if (!(failure instanceof ApiFailure)) throw failure;
        if (failure.status === 503) {
          const order = failure.body.order;
          handle.close();
          if (order !== undefined) navigate(`/exercises/${order.id}`);
          announce(failure.message);
          return;
        }
        const message = failure.fields["options"] ?? failure.message;
        error.hidden = false;
        error.textContent = `Error: ${message}`;
        announce(message);
      }
    }

    confirm.addEventListener("click", () => void place());
    input.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void place();
      }
    });
    applySocketState();
  }

  async function accept(): Promise<void> {
    if (grant === null) return;
    announce("Sealing your signed agreement in the vault.");
    try {
      await api<Grant>(`/api/grants/${grant.id}/accept`, { method: "POST", body: {} });
      signaturePending = false;
      await draw();
      announce(`Grant ${grantId} accepted. Your signed agreement is sealed in the vault.`);
      const exercise = document.querySelector<HTMLElement>("[data-exercise-open]");
      if (exercise !== null) exercise.focus();
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.status === 503) {
        signaturePending = true;
        await draw();
        announce(failure.message);
        return;
      }
      await draw();
      announce(failure.message);
    }
  }

  async function decline(): Promise<void> {
    if (grant === null) return;
    try {
      await api<Grant>(`/api/grants/${grant.id}/decline`, { method: "POST", body: {} });
      await draw();
      announce(`Grant ${grantId} declined and returned to the board.`);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      await draw();
      announce(failure.message);
    }
  }

  async function draw(): Promise<void> {
    const me = signedInAs();
    const loaded = await load();
    clear(context.main);
    const now = serverNow();

    const offerStrip = offerWarningStrip([loaded], now);
    if (offerStrip !== null) context.main.append(offerStrip);
    const windowStrip = me.role === "leaver" ? windowWarningStrip(me, [loaded], now) : null;
    if (windowStrip !== null) context.main.append(windowStrip);

    const column = el("div", { class: "column" });
    const side = el("div", { class: "side" }, [
      el("p", { class: "side-note" }, [loaded.holder_name ?? ""]),
      el("p", { class: "side-note" }, [loaded.id]),
    ]);

    column.append(
      el("h1", { class: "chapter-title" }, [loaded.id]),
      el("p", { class: "state-word" }, [GRANT_STATE_WORDS[loaded.state]]),
    );

    if (loaded.state === "offered" && loaded.options !== null && loaded.vesting_type !== null) {
      const agreement = grantAgreementText({
        grantId: loaded.id,
        holderName: loaded.holder_name ?? "",
        options: loaded.options,
        strike: loaded.strike ?? "",
        vestingType: loaded.vesting_type,
        vestingStart: loaded.vesting_start ?? "",
        signedAt: null,
      });
      column.append(
        el("section", { class: "agreement", role: "region", "aria-label": "Grant agreement" }, [
          el("pre", { class: "document-text" }, [agreement]),
        ]),
      );
      if (signaturePending) {
        const retry = liveButton("Retry signing", { class: "primary" });
        retry.addEventListener("click", () => void accept());
        column.append(
          el("section", { class: "band band-red" }, [
            el("p", {}, [
              `The document vault can't be reached. Your signature is pending and grant ${loaded.id} is not yet accepted.`,
            ]),
            retry,
          ]),
        );
      }
      const acceptButton = liveButton("Accept grant", { class: "primary" });
      acceptButton.addEventListener("click", () => void accept());
      const declineButton = liveButton("Decline grant");
      declineButton.addEventListener("click", () => void decline());
      column.append(el("div", { class: "actions" }, [acceptButton, declineButton]));
    }

    if (loaded.state === "accepted") {
      if (me.role === "leaver" && loaded.exercise_window_ends_at !== null) {
        const remaining = new Date(loaded.exercise_window_ends_at).getTime() - now.getTime();
        countdownNode = el("span", { role: "timer", "aria-label": "Exercise window" }, [
          remaining > 0 ? `${formatCountdown(remaining)} left` : "Window closed",
        ]);
        column.append(el("div", { class: "band band-ink leaver-band" }, [countdownNode]));
        column.append(
          el("div", { class: "labelled" }, [
            el("span", { class: "labelled-label" }, ["Exercisable now"]),
            el("span", { class: "labelled-value", "data-exercisable": "" }, [formatCount(loaded.exercisable)]),
          ]),
        );
      }

      ribbon = buildRibbon(loaded);
      marker = serverMark(loaded);
      slider = el("div", {
        role: "slider",
        tabindex: "0",
        class: "projection-slider",
        "aria-label": "Projection date",
        "aria-valuemin": "0",
        "aria-valuemax": "48",
        "aria-valuenow": String(marker),
        "aria-valuetext": markerValueText(),
      });
      slider.addEventListener("keydown", (event: KeyboardEvent) => {
        const moves: Record<string, number> = {
          ArrowRight: 1,
          ArrowUp: 1,
          ArrowLeft: -1,
          ArrowDown: -1,
          PageUp: 12,
          PageDown: -12,
        };
        if (event.key in moves) {
          event.preventDefault();
          setMarker(marker + (moves[event.key] ?? 0));
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          setMarker(serverMark(loaded));
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          setMarker(48);
        }
      });

      const tranche = loaded.schedule[marker];
      vestedNode = el("span", { class: "labelled-value" }, [formatCount(tranche?.cumulative ?? 0)]);
      costNode = el("span", { class: "labelled-value" }, [formatMoney(tranche?.cost_at_strike ?? "0.00")]);
      ownershipNode = el("span", { class: "labelled-value" }, [`${tranche?.vested_ownership ?? "0.00"}%`]);

      const markerFromCell = (index: number): void => {
        const cell = ribbon?.cells[index];
        const lastMark = cell?.marks[cell.marks.length - 1];
        if (lastMark !== undefined) setMarker(lastMark);
      };
      ribbon.nodes.forEach((node, index) => {
        node.addEventListener("pointerdown", () => {
          markerFromCell(index);
          slider?.focus();
        });
        node.addEventListener("pointerenter", (event: PointerEvent) => {
          if (event.buttons === 1) markerFromCell(index);
        });
      });

      column.append(
        el("section", { class: "ribbon", role: "group", "aria-label": "Tranche ribbon" }, [ribbon.track]),
        slider,
        el("section", { class: "figures", role: "group", "aria-label": "Projection figures" }, [
          el("div", { class: "labelled" }, [el("span", { class: "labelled-label" }, ["Vested"]), vestedNode]),
          el("div", { class: "labelled" }, [el("span", { class: "labelled-label" }, ["Cost to exercise"]), costNode]),
          el("div", { class: "labelled" }, [
            el("span", { class: "labelled-label" }, ["Vested ownership"]),
            ownershipNode,
          ]),
        ]),
      );

      if (loaded.holder_id === me.id) {
        const exercise = liveButton("Exercise", { class: "primary", "data-exercise-open": "" });
        exercise.addEventListener("click", () => openExerciseDialog());
        column.append(el("div", { class: "actions" }, [exercise]));
      }
    }

    context.main.append(el("div", { class: "axis-grid" }, [side, column]));
    if (ribbon !== null) {
      ribbon.paint(marker);
      setMarker(marker);
    }
    applySocketState();
  }

  return {
    async render(): Promise<void> {
      await draw();
    },
    onEvent(event: LiveEvent): void {
      if (event.type === "clock") {
        if (countdownNode !== null && grant?.exercise_window_ends_at != null) {
          const remaining = new Date(grant.exercise_window_ends_at).getTime() - serverNow().getTime();
          countdownNode.textContent = remaining > 0 ? `${formatCountdown(remaining)} left` : "Window closed";
        }
        return;
      }
      const affected = event.data["grant_id"];
      if ((event.type === "tranche_vested" || event.type === "window_closed") && affected === grantId && ribbon !== null) {
        void load().then((loaded) => {
          ribbon?.update(loaded, marker);
          paintFigures(marker);
          const exercisable = document.querySelector<HTMLElement>("[data-exercisable]");
          if (exercisable !== null) {
            countTo(exercisable, Number(exercisable.textContent?.replace(/[^\d]/g, "") ?? "0"), loaded.exercisable, (value) =>
              formatCount(value),
            );
          }
        });
        return;
      }
      if (
        event.type === "cap_table" ||
        (typeof affected === "string" && affected === grantId) ||
        event.type === "offer_warning" ||
        event.type === "window_warning" ||
        event.type === "window_closed"
      ) {
        void draw();
      }
    },
  };
}

export function vestingRedirectPage(context: PageContext): Page {
  return {
    async render(): Promise<void> {
      const result = await api<{ grants: Grant[] }>("/api/grants");
      const target = result.grants.find((grant) => grant.state === "accepted" || grant.state === "offered");
      if (target === undefined) {
        clear(context.main);
        context.main.append(el("section", { class: "band band-ink full" }, [el("p", {}, ["You hold no grants yet."])]));
        return;
      }
      navigate(`/grants/${target.id}`, { replace: true });
    },
  };
}
