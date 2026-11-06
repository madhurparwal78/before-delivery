import { api, ApiFailure, newKey, money, mmss } from "./api.js";
import { el, clear, announce, openDialog, field, mountStatus } from "./ui.js";
import { state, refreshBenches, refreshMe, emit, type Reservation } from "./state.js";
import { LabScene, webglAvailable, prefersReducedMotion, type BenchSceneState } from "./scene.js";

/**
 * The lab chapter: the tier switch, the bench map, the hold panel and the
 * checkout. Holds are server-timed: the countdown always comes from the
 * server's status, counted down on the page's own elapsed time.
 */

export interface LabHandle {
  root: HTMLElement;
  refresh(): void;
}

const ROWS = ["A", "B", "C", "D"];

interface HoldModel {
  reservations: Reservation[];
  groupId: string | null;
  expiresAt: number;
  duration: number;
  pending: boolean;
  /** A message that outlasts the timer (confirmation, pending, billing). */
  pinned?: { kind: "confirmation" | "pending" | "billing"; text: string };
  holdEndedShown: boolean;
}

export function buildLab(dockedBar: HTMLElement): LabHandle {
  const root = el("section", { class: "chapter", id: "chapter-lab" });

  const head = el("div", { class: "chapter-head" });
  head.append(
    el("p", { class: "chapter-no" }, "04"),
    el("h2", { class: "chapter-title", id: "lab-heading", tabindex: "-1" }, "The lab")
  );
  const intro = el("div", { class: "chapter-body" });
  intro.append(
    el("p", { class: "lede" }, "Twenty-four benches in four rows. Row A faces the demo station; the Atelier rows carry gold rims and their own dinner."),
    el("p", {}, "Pick a bench and hold it while you pay. Every hold runs on the server's clock.")
  );

  const layout = el("div", { class: "lab-layout" });

  let sceneMode: "scene" | "plan" = "scene";

  const reduced = prefersReducedMotion();
  const hasWebgl = webglAvailable();

  const planNote = el("p", { class: "plan-note", hidden: "true" }, "The 3D lab needs WebGL. Here is the flat bench plan.");

  if (reduced || !hasWebgl) {
    sceneMode = "plan";
    if (!reduced) planNote.hidden = false;
  }

  const sceneCol = el("div", { class: "scene-col" });
  let sceneWrap: HTMLElement | null = el("div", { class: "scene-wrap" });
  const sceneRegion = el("div", {
    class: "lab-scene",
    role: "region",
    "aria-label": "Lab scene",
    "data-azimuth": "0.0",
    "data-elevation": "62.0",
    "data-scroll-progress": "0.00",
    "data-selected-bench": "",
    "data-ready": "false",
    "data-lift": "0.00",
    "data-ring": "none",
  });
  if (sceneMode === "scene") {
    sceneWrap.append(sceneRegion);
    sceneCol.append(sceneWrap);
  } else {
    // Under reduced motion or without WebGL the scene is not rendered at all.
    sceneWrap = null;
    layout.style.gridTemplateColumns = "minmax(0, 1fr)";
  }

  const benchCol = el("div", { class: "bench-col" });

  const tierSwitch = el("div", { class: "tier-switch", role: "radiogroup", "aria-label": "Tier" });
  const benchRadio = el("input", { type: "radio", name: "tier", id: "tier-bench", value: "bench" }) as HTMLInputElement;
  const atelierRadio = el("input", { type: "radio", name: "tier", id: "tier-atelier", value: "atelier" }) as HTMLInputElement;
  benchRadio.checked = true;
  const soldOutLabel = el("span", { class: "sold-out", hidden: "true" }, "Sold out");
  tierSwitch.append(
    el("label", { class: "radiolabel" }, benchRadio, "Bench"),
    el("label", { class: "radiolabel" }, atelierRadio, "Atelier", soldOutLabel)
  );

  const soldOutBanner = el("div", { class: "soldout-banner", hidden: "true" });
  const billingBanner = el("div", { class: "billing-banner", role: "alert", hidden: "true" }, "Billing is offline right now. Your hold keeps running and no money has moved.");
  const mapWrap = el("div", { class: "bench-map", role: "grid", "aria-label": "Bench map" });
  const benchUpdates = mountStatus(benchCol, "Bench updates");
  const holdPanel = el("div", { class: "hold-panel", role: "region", "aria-label": "Your hold", hidden: "true" });

  benchCol.append(tierSwitch, soldOutBanner, billingBanner, planNote, mapWrap, holdPanel);
  benchCol.append(benchUpdates);

  if (sceneMode === "scene") {
    layout.append(sceneCol);
  }
  layout.append(benchCol);
  root.append(head, intro, layout);

  const waitlistBtn = el("button", { class: "btn btn-gold", hidden: "true" }, "Join the waitlist");

  let tier: "bench" | "atelier" = "bench";
  let hold: HoldModel | null = null;
  let pendingRequest: { benches: string[] } | null = null;
  let selection: string[] = [];
  let scene: LabScene | null = null;
  let signTarget: string[] | null = null;

  // ---------- Bench state text ----------

  function stateText(bench: { label: string; row: string; state: string }): string {
    switch (bench.state) {
      case "held_by_you":
        return "Held by you";
      case "offered_to_you":
        return "Offered to you";
      case "held":
        return "Held";
      case "sold":
        return "Sold";
      case "yours":
        return "Yours";
    }
    const soldOut = state.benches?.tiers.atelier.sold_out ?? false;
    const atelierRow = bench.row === "A" || bench.row === "B";
    if (atelierRow && soldOut) return "Sold out";
    if (atelierRow && tier === "bench") return "Atelier only";
    return "Open";
  }

  function sceneState(bench: { label: string; row: string; state: string }): BenchSceneState {
    if (bench.state !== "open") return bench.state as BenchSceneState;
    const soldOut = state.benches?.tiers.atelier.sold_out ?? false;
    const atelierRow = bench.row === "A" || bench.row === "B";
    if (atelierRow && soldOut) return "sold_out";
    if (atelierRow && tier === "bench") return "atelier_only";
    return "open";
  }

  // ---------- Bench map ----------

  const benchButtons = new Map<string, HTMLButtonElement>();

  function isMobileLayout(): boolean {
    return window.innerWidth < 768;
  }

  function renderMap(): void {
    const benches = state.benches;
    if (!benches) return;
    clear(mapWrap);
    benchButtons.clear();
    const stacked = isMobileLayout();
    mapWrap.classList.toggle("bench-stack", stacked);

    for (const rowLetter of ROWS) {
      const rowBenches = benches.benches.filter((b) => b.row === rowLetter);
      if (rowBenches.length === 0) continue;
      const rowEl = el("div", { class: "bench-row", role: "row", "aria-label": `Row ${rowLetter}` });
      rowEl.append(el("span", { class: "row-label" }, `Row ${rowLetter}`));
      const cells = el("div", { class: "bench-grid" });
      for (const bench of rowBenches) {
        const text = stateText(bench);
        const btn = el("button", {
          class: `bench-btn state-${bench.state}${bench.row === "A" || bench.row === "B" ? " atelier" : ""}`,
          role: "gridcell",
          "aria-label": `Bench ${bench.label}, ${text}`,
          "data-bench": bench.label,
          tabindex: "-1",
        });
        const glyph = glyphFor(bench, text);
        btn.append(
          el("span", { class: "glyph", "aria-hidden": "true" }, glyph),
          el("span", { class: "bench-label num" }, bench.label)
        );
        if (!["Open", "Held by you", "Offered to you"].includes(text)) {
          btn.setAttribute("aria-disabled", "true");
        }
        if (selection.includes(bench.label)) btn.classList.add("selected");
        btn.addEventListener("click", () => onBenchActivate(bench.label, btn));
        btn.addEventListener("keydown", (event) => onBenchKey(event, bench.label));
        benchButtons.set(bench.label, btn);
        cells.append(btn);
      }
      rowEl.append(cells);
      mapWrap.append(rowEl);
    }

    // One Tab stop: the held bench, or the first Open bench.
    const myHoldBench = hold?.reservations[0]?.bench;
    const focusBench =
      myHoldBench && benchButtons.get(myHoldBench)
        ? myHoldBench
        : benches.benches.find((b) => stateText(b) === "Open")?.label ?? null;
    if (focusBench) benchButtons.get(focusBench)!.setAttribute("tabindex", "0");

    if (scene) {
      scene.setBenchStates(benches.benches.map((b) => ({ label: b.label, state: sceneState(b) })), hold?.reservations.map((r) => r.bench) ?? []);
    }
  }

  function glyphFor(bench: { state: string; row: string }, text: string): string {
    if (text === "Sold out" || text === "Atelier only") return "⌸";
    if (bench.state === "held") return "⏱";
    if (bench.state === "sold") return "•";
    if (bench.state === "held_by_you" || bench.state === "offered_to_you") return "◍";
    return "";
  }

  // ---------- Keyboard ----------

  function onBenchKey(event: KeyboardEvent, label: string): void {
    const benches = state.benches?.benches ?? [];
    const index = benches.findIndex((b) => b.label === label);
    if (index === -1) return;
    let target = -1;
    const stacked = isMobileLayout();
    if (event.key === "ArrowLeft") target = stacked ? index - 1 : sameRowNeighbor(benches, index, -1);
    else if (event.key === "ArrowRight") target = stacked ? index + 1 : sameRowNeighbor(benches, index, +1);
    else if (event.key === "ArrowUp") target = stacked ? index - 1 : index - 6;
    else if (event.key === "ArrowDown") target = stacked ? index + 1 : index + 6;
    else if (event.key === "Home") target = rowStart(benches, index);
    else if (event.key === "End") target = rowEnd(benches, index);
    else if (event.key === "Enter") {
      event.preventDefault();
      onBenchActivate(label, benchButtons.get(label)!);
      return;
    } else if (event.key === " ") {
      event.preventDefault();
      return;
    } else {
      return;
    }
    event.preventDefault();
    if (target >= 0 && target < benches.length) {
      const btn = benchButtons.get(benches[target]!.label);
      if (btn) {
        for (const b of benchButtons.values()) b.setAttribute("tabindex", "-1");
        btn.setAttribute("tabindex", "0");
        btn.focus();
      }
    }
  }

  function sameRowNeighbor(benches: { label: string; row: string }[], index: number, delta: number): number {
    const neighbor = index + delta;
    if (neighbor < 0 || neighbor >= benches.length) return index;
    if (benches[neighbor]!.row !== benches[index]!.row) return index;
    return neighbor;
  }

  function rowStart(benches: { row: string }[], index: number): number {
    const row = benches[index]!.row;
    return benches.findIndex((b) => b.row === row);
  }

  function rowEnd(benches: { row: string }[], index: number): number {
    const row = benches[index]!.row;
    let last = index;
    for (let i = benches.length - 1; i >= 0; i--) {
      if (benches[i]!.row === row) {
        last = i;
        break;
      }
    }
    return last;
  }

  // ---------- Activation ----------

  function isClinic(): boolean {
    return state.me?.account.role === "clinic";
  }

  function onBenchActivate(label: string, opener: HTMLElement): void {
    const bench = state.benches?.benches.find((b) => b.label === label);
    if (!bench) return;
    const text = stateText(bench);

    if (isClinic()) {
      if (text !== "Open") {
        if (bench.state === "held_by_you") return; // already ours
        if (text === "Atelier only") {
          announce("Bench updates", `Bench ${label} is an Atelier bench. Switch to Atelier to hold it.`);
        }
        return;
      }
      if (selection.includes(label)) {
        selection = selection.filter((s) => s !== label);
      } else {
        if (selection.length >= 6) return;
        selection.push(label);
      }
      renderMap();
      updatePanel();
      if (scene) scene.setBenchStates(state.benches!.benches.map((b) => ({ label: b.label, state: sceneState(b) })), selection);
      return;
    }

    if (!state.me) {
      signTarget = [label];
      openSignin(opener, () => {
        if (signTarget) {
          const target = signTarget;
          signTarget = null;
          requestHold(target);
        }
      });
      return;
    }
    if (text === "Atelier only") {
      announce("Bench updates", `Bench ${label} is an Atelier bench. Switch to Atelier to hold it.`);
      return;
    }
    if (text !== "Open") return;
    requestHold([label]);
  }

  function requestHold(benches: string[]): void {
    if (hold && hold.reservations.length > 0 && !hold.pending) {
      // A practitioner holds one bench; release the old hold first is not
      // automatic, so ignore extra holds.
    }
    pendingRequest = { benches };
    showPending(benches);
    announce("Bench updates", isClinic() ? `Holding ${benches.length} benches` : `Holding Bench ${benches[0]}`);
    api<{ reservations: Reservation[]; group_id: string | null; seats_remaining: number; server_time: string }>(
      "/api/holds",
      { method: "POST", body: JSON.stringify({ benches }) }
    )
      .then(async (res) => {
        pendingRequest = null;
        hold = {
          reservations: res.reservations,
          groupId: res.group_id,
          expiresAt: new Date(res.reservations[0]!.hold!.expires_at).getTime(),
          duration: res.reservations[0]!.hold!.duration_seconds,
          pending: false,
          holdEndedShown: false,
        };
        if (scene) {
          scene.setSelectedBench(res.reservations[0]!.bench);
          scene.startLiftFor(res.reservations.map((r) => r.bench));
          scene.setRing("depleting", 1);
        }
        const n = res.reservations.length;
        announce(
          "Bench updates",
          n > 1
            ? `${n} benches are held for you. ${res.seats_remaining} of 24 seats remaining.`
            : `Bench ${res.reservations[0]!.bench} is held for you. ${res.seats_remaining} of 24 seats remaining.`
        );
        await refreshBenches();
        renderMap();
        updatePanel();
        emit();
      })
      .catch(async (e) => {
        pendingRequest = null;
        if (e instanceof ApiFailure) {
          await refreshBenches();
          renderMap();
          updatePanel();
          hold = null;
          if (e.body.error === "bench_taken") {
            announce("Bench updates", `Bench ${benches[0]} was just taken. ${state.benches?.seats_remaining ?? ""} of 24 seats remaining.`);
          } else if (e.body.error === "atelier_sold_out") {
            announce("Bench updates", `Atelier is sold out. ${state.benches?.seats_remaining ?? ""} of 24 seats remaining.`);
          } else if (e.body.error === "already_reserved" || e.body.error === "hold_limit") {
            announce("Bench updates", e.body.message);
          } else {
            announce("Bench updates", e.body.message);
          }
        }
      });
  }

  function showPending(benches: string[]): void {
    holdPanel.hidden = false;
    clear(holdPanel);
    holdPanel.append(el("p", { class: "pending" }, isClinic() ? `Holding ${benches.length} benches` : `Holding Bench ${benches[0]}`));
  }

  // ---------- Hold panel ----------

  let panelPinned: { kind: "confirmation" | "pending" | "billing"; bench: string; text: string } | null = null;

  function updatePanel(): void {
    const benches = state.benches;
    const myHoldRes = hold;
    clear(holdPanel);

    const showDeposit = benches?.deposits_open ?? true;

    if (panelPinned) {
      holdPanel.hidden = false;
      if (panelPinned.kind === "confirmation") {
        holdPanel.append(
          el("h3", { class: "confirmation", id: "hold-panel-heading", tabindex: "-1" }, panelPinned.text),
          el("p", {}, "Your receipt is in your account and on its way by email.")
        );
        const done = el("button", { class: "btn btn-live" }, "Done");
        done.addEventListener("click", () => {
          panelPinned = null;
          updatePanel();
          document.getElementById("hold-panel-heading")?.focus();
        });
        holdPanel.append(done);
      } else {
        holdPanel.append(el("h3", {}, panelPinned.text), el("p", {}, "We will update this page and email your receipt."));
      }
      return;
    }

    if (pendingRequest) {
      holdPanel.hidden = false;
      clear(holdPanel);
      holdPanel.append(el("p", { class: "pending" }, pendingRequest.benches.length > 1 ? `Holding ${pendingRequest.benches.length} benches` : `Holding Bench ${pendingRequest.benches[0]}`));
      return;
    }
    if (!myHoldRes || myHoldRes.pending) {
      if (!myHoldRes) holdPanel.hidden = true;
      return;
    }

    holdPanel.hidden = false;
    const heading = el("h3", { id: "hold-panel-heading", tabindex: "-1" });
    if (reduced || sceneMode === "plan") {
      heading.append(myHoldRes.reservations.map((r) => r.bench).join(", "));
    } else {
      const label = myHoldRes.reservations.map((r) => r.bench).join(", ");
      heading.setAttribute("aria-label", label);
      for (const ch of label) {
        const span = el("span", { class: "letter", "data-letter": ch, "aria-hidden": "true" }, ch);
        heading.append(span);
      }
    }

    const timerText = el("span", { class: "time mono num" }, "00:00");
    const timer = el(
      "div",
      { class: "hold-timer" },
      el("span", {}, "Hold time remaining"),
      timerText
    );
    timer.setAttribute("role", "timer");
    timer.setAttribute("aria-label", "Hold time remaining");

    holdPanel.append(heading, timer);
    if (!showDeposit) {
      holdPanel.append(el("p", { class: "deposits-closed-note" }, "Deposits closed on 19 March 2027. Pay in full to reserve a bench."));
    }

    const actions = el("div", { class: "hold-actions" });
    const multi = myHoldRes.groupId !== null;

    if (!multi) {
      const r = myHoldRes.reservations[0]!;
      if (showDeposit) {
        const payDeposit = el("button", { class: "btn btn-live" }, `Pay deposit $${money(r.tier === "atelier" ? 150000 : 90000)}`);
        payDeposit.addEventListener("click", () => openCheckout(r, "deposit", payDeposit));
        actions.append(payDeposit);
      }
      const payFull = el("button", { class: "btn btn-gold" }, `Pay in full $${money(r.price_cents)}`);
      payFull.addEventListener("click", () => openCheckout(r, "full", payFull));
      actions.append(payFull);
    } else {
      const payGroup = el("button", { class: "btn btn-live" }, `Pay group invoice $${money(myHoldRes.reservations.reduce((s, r) => s + r.price_cents, 0))}`);
      payGroup.addEventListener("click", () => openGroupCheckout(myHoldRes.groupId!, myHoldRes.reservations, payGroup));
      actions.append(payGroup);
    }
    const release = el("button", { class: "btn btn-quiet" }, multi ? "Release group" : "Release bench");
    release.addEventListener("click", () => releaseHold());
    actions.append(release);
    holdPanel.append(actions);

    startCountdown(timerText);
  }

  function startCountdown(timerText: HTMLElement): void {
    const tick = () => {
      if (!hold || hold.pending) return;
      const remainingMs = hold.expiresAt - Date.now();
      const remaining = Math.max(0, remainingMs / 1000);
      timerText.textContent = mmss(remaining);
      if (scene) scene.updateRing(remaining / hold.duration);
      if (remaining <= 0) {
        if (panelPinned) {
          // A payment was sent before the countdown ended; the confirmation
          // stays on screen.
          timerText.textContent = "00:00";
          return;
        }
        timerText.textContent = "00:00";
        showChecking();
        window.setTimeout(tick, 500);
        return;
      }
      window.setTimeout(tick, 250);
    };
    tick();
  }

  function showChecking(): void {
    const existing = holdPanel.querySelector("[data-checking]");
    if (existing) return;
    const note = el("p", { "data-checking": "true", class: "hint" }, "Checking your hold");
    const timerEl = holdPanel.querySelector(".hold-timer");
    timerEl?.after(note);
  }

  async function releaseHold(): Promise<void> {
    if (!hold) return;
    const bench = hold.reservations[0]!.bench;
    const groupId = hold.groupId;
    try {
      if (groupId) {
        await api(`/api/groups/${groupId}/release`, { method: "POST" });
      } else {
        await api(`/api/reservations/${hold.reservations[0]!.id}/release`, { method: "POST" });
      }
      hold = null;
      panelPinned = null;
      if (scene) {
        scene.setSelectedBench(null);
        scene.setRing("none");
      }
      await refreshBenches();
      await refreshMe();
      renderMap();
      updatePanel();
      announce("Bench updates", `Bench ${bench} released. ${state.benches?.seats_remaining ?? ""} of 24 seats remaining.`);
      emit();
    } catch {
      /* the hold stays */
    }
  }

  // ---------- Checkout ----------

  function openCheckout(reservation: Reservation, kind: "deposit" | "full", opener: HTMLElement): void {
    const payBtn = { current: null as HTMLElement | null };
    openDialog({
      label: "Checkout",
      opener,
      build: (dialog) => {
        const form = el("form", { class: "checkout" });
        const nameInput = el("input", { type: "text", name: "billing_name", id: "billing-name", value: state.me?.account.name ?? "" }) as HTMLInputElement;
        const amount = kind === "deposit" ? (reservation.tier === "atelier" ? 150000 : 90000) : reservation.price_cents;
        const label = kind === "deposit" ? `Pay deposit $${money(amount)}` : `Pay in full $${money(amount)}`;
        const submit = el("button", { class: "btn btn-live", type: "submit" }, label) as HTMLButtonElement;
        payBtn.current = submit;

        form.append(
          el("h2", {}, "Checkout"),
          field("Name for the receipt", nameInput),
          submit,
          el("button", { class: "btn btn-quiet", type: "button", "data-close": "true" }, "Close")
        );

        const confirmation = el("div", { hidden: "true", class: "confirmation" });
        form.append(confirmation);

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          submit.disabled = true;
          submit.textContent = "Processing payment";
          try {
            const res = await api<{ reservation: Reservation }>(`/api/reservations/${reservation.id}/${kind}`, {
              method: "POST",
              body: JSON.stringify({ billing_name: nameInput.value }),
              idempotencyKey: newKey(),
            });
            const updated = res.reservation;
            const bench = updated.bench;
            const remaining = state.benches?.seats_remaining ?? 24;
            if (updated.state === "deposit_paid" || updated.state === "paid_in_full") {
              submit.hidden = true;
              confirmation.hidden = false;
              clear(confirmation);
              confirmation.append(el("h2", {}, `Bench ${bench} is yours`));
              const done = el("button", { class: "btn btn-live", type: "button" }, "Done");
              done.addEventListener("click", () => {
                dialog.close();
                window.setTimeout(() => {
                  document.getElementById("hold-panel-heading")?.focus();
                }, 60);
              });
              confirmation.append(done);
              announce("Bench updates", `Bench ${bench} is yours. ${remaining} of 24 seats remaining.`);
              panelPinned = { kind: "confirmation", bench, text: `Bench ${bench} is yours` };
              hold = null;
              if (scene) {
                scene.setRing("band");
              }
              await refreshBenches();
              await refreshMe();
              renderMap();
              updatePanel();
              emit();
            } else if (updated.payment_pending) {
              submit.hidden = true;
              confirmation.hidden = false;
              clear(confirmation);
              confirmation.append(el("h2", {}, `Payment for Bench ${bench} is being confirmed.`));
              confirmation.append(el("p", {}, "We will update this page and email your receipt."));
              const done = el("button", { class: "btn", type: "button" }, "Done");
              done.addEventListener("click", () => dialog.close());
              confirmation.append(done);
              announce("Bench updates", `Payment for Bench ${bench} is being confirmed. We will update this page and email your receipt.`);
              panelPinned = { kind: "pending", bench, text: `Payment for Bench ${bench} is being confirmed` };
              hold = null;
              await refreshBenches();
              renderMap();
              updatePanel();
              emit();
            }
          } catch (e) {
            submit.disabled = false;
            submit.textContent = label;
            if (e instanceof ApiFailure) {
              if (e.body.error === "billing_unavailable") {
                clear(confirmation);
                confirmation.hidden = false;
                confirmation.append(
                  el("h2", {}, "Billing is offline right now."),
                  el("p", {}, "Your hold keeps running and no money has moved.")
                );
                announce("Bench updates", "Billing is offline right now. Your hold keeps running and no money has moved.");
                panelPinned = { kind: "billing", bench: reservation.bench, text: "Billing is offline right now. Your hold keeps running and no money has moved." };
                billingBanner.hidden = false;
                state.billingDown = true;
                updatePanel();
              } else {
                const errorNote = el("p", { class: "field-error" }, e.body.message);
                form.insertBefore(errorNote, submit);
              }
            }
          }
        });
        form.querySelector('[data-close]')?.addEventListener("click", () => dialog.close());
        return form;
      },
    });
  }

  function openGroupCheckout(groupId: string, reservations: Reservation[], opener: HTMLElement): void {
    openDialog({
      label: "Group checkout",
      opener,
      build: (dialog) => {
        const form = el("form", { class: "checkout" });
        form.append(el("h2", {}, "Group checkout"));
        const seatFields: { bench: string; name: HTMLInputElement; email: HTMLInputElement }[] = [];
        for (const r of reservations) {
          const fs = el("fieldset");
          fs.append(el("legend", {}, `Bench ${r.bench}`));
          const name = el("input", { type: "text", "aria-label": `Colleague name for Bench ${r.bench}` }) as HTMLInputElement;
          const email = el("input", { type: "email", "aria-label": `Colleague email for Bench ${r.bench}` }) as HTMLInputElement;
          fs.append(field(`Colleague name for Bench ${r.bench}`, name), field(`Colleague email for Bench ${r.bench}`, email));
          form.append(fs);
          seatFields.push({ bench: r.bench, name, email });
        }
        const receiptName = el("input", { type: "text", value: state.me?.account.clinic_name ?? state.me?.account.name ?? "" }) as HTMLInputElement;
        const total = reservations.reduce((s, r) => s + r.price_cents, 0);
        const submit = el("button", { class: "btn btn-live", type: "submit" }, `Pay group invoice $${money(total)}`) as HTMLButtonElement;
        const closeBtn = el("button", { class: "btn btn-quiet", type: "button" }, "Close");
        const confirmation = el("div", { hidden: "true", class: "confirmation" });
        form.append(field("Name for the receipt", receiptName), submit, closeBtn, confirmation);

        closeBtn.addEventListener("click", () => dialog.close());

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          submit.disabled = true;
          submit.textContent = "Processing payment";
          const assignments = seatFields
            .filter((s) => s.name.value.trim() !== "" || s.email.value.trim() !== "")
            .map((s) => ({ bench: s.bench, name: s.name.value.trim(), email: s.email.value.trim() }));
          try {
            const res = await api<{ group: { state: string } }>(`/api/groups/${groupId}/checkout`, {
              method: "POST",
              body: JSON.stringify({ billing_name: receiptName.value, assignments }),
              idempotencyKey: newKey(),
            });
            submit.hidden = true;
            confirmation.hidden = false;
            clear(confirmation);
            confirmation.append(el("h2", {}, `Group invoice confirmed: ${reservations.length} seats on one invoice`));
            const done = el("button", { class: "btn btn-live", type: "button" }, "Done");
            done.addEventListener("click", () => {
              dialog.close();
              document.getElementById("hold-panel-heading")?.focus();
            });
            confirmation.append(done);
            const remaining = state.benches?.seats_remaining ?? 24;
            announce("Bench updates", `${reservations.length} benches are yours. ${remaining} of 24 seats remaining.`);
            panelPinned = { kind: "confirmation", bench: reservations[0]!.bench, text: `Group invoice confirmed: ${reservations.length} seats on one invoice` };
            hold = null;
            if (scene) scene.setRing("band");
            await refreshBenches();
            await refreshMe();
            renderMap();
            updatePanel();
            emit();
          } catch (e) {
            submit.disabled = false;
            submit.textContent = `Pay group invoice $${money(total)}`;
            if (e instanceof ApiFailure) {
              if (e.body.error === "billing_unavailable") {
                confirmation.hidden = false;
                clear(confirmation);
                confirmation.append(el("h2", {}, "Billing is offline right now."), el("p", {}, "Your hold keeps running and no money has moved."));
                announce("Bench updates", "Billing is offline right now. Your hold keeps running and no money has moved.");
                state.billingDown = true;
                billingBanner.hidden = false;
              } else {
                confirmation.hidden = false;
                clear(confirmation);
                confirmation.append(el("p", { class: "field-error" }, e.body.message));
              }
            }
          }
        });
        return form;
      },
    });
  }

  function openSignin(opener: HTMLElement, onSignedIn?: () => void): void {
    let signedIn = false;
    openDialog({
      label: "Sign in",
      opener,
      build: (dialog) => {
        const form = el("form", {});
        const email = el("input", { type: "email", id: "signin-email" }) as HTMLInputElement;
        const password = el("input", { type: "password", id: "signin-password" }) as HTMLInputElement;
        const errorNote = el("p", { class: "field-error", hidden: "true" });
        const submit = el("button", { class: "btn btn-live", type: "submit" }, "Sign in");
        const createBtn = el("button", { class: "btn btn-quiet", type: "button" }, "Create an account");
        const closeBtn = el("button", { class: "btn btn-quiet", type: "button" }, "Close");
        form.append(el("h2", {}, "Sign in"), field("Email", email), field("Password", password), errorNote, submit, el("div", { class: "dialog-actions" }, createBtn, closeBtn));

        closeBtn.addEventListener("click", () => dialog.close());
        createBtn.addEventListener("click", () => {
          dialog.close();
          openCreateAccount(opener, onSignedIn);
        });

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            await api("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: email.value, password: password.value }) });
            await refreshMe();
            signedIn = true;
            dialog.close();
          } catch (e) {
            errorNote.hidden = false;
            errorNote.textContent = "Email or password is incorrect.";
          }
        });
        return form;
      },
      onClose: () => {
        if (signedIn && onSignedIn) onSignedIn();
      },
    });
  }

  function openCreateAccount(opener: HTMLElement, onSignedIn?: () => void): void {
    let accountCreated = false;
    openDialog({
      label: "Create account",
      opener,
      build: (dialog) => {
        const form = el("form", {});
        const name = el("input", { type: "text" }) as HTMLInputElement;
        const email = el("input", { type: "email" }) as HTMLInputElement;
        const password = el("input", { type: "password" }) as HTMLInputElement;
        const clinicName = el("input", { type: "text", hidden: "true" }) as HTMLInputElement;
        const clinicWrap = el("label", { class: "form-field", hidden: "true" });
        clinicWrap.append(el("span", {}, "Clinic name"), clinicName);
        const radios = el("div", { class: "radios", role: "radiogroup", "aria-label": "Account type" });
        const pract = el("input", { type: "radio", name: "kind", value: "practitioner", checked: "true" }) as HTMLInputElement;
        const clinic = el("input", { type: "radio", name: "kind", value: "clinic" }) as HTMLInputElement;
        radios.append(
          el("label", { class: "radiolabel" }, pract, "Practitioner"),
          el("label", { class: "radiolabel" }, clinic, "Clinic")
        );
        clinic.addEventListener("change", () => {
          clinicWrap.hidden = !clinic.checked;
        });
        pract.addEventListener("change", () => {
          clinicWrap.hidden = true;
        });
        const errorNote = el("p", { class: "field-error", hidden: "true" });
        const submit = el("button", { class: "btn btn-live", type: "submit" }, "Create account");
        const closeBtn = el("button", { class: "btn btn-quiet", type: "button" }, "Close");
        form.append(
          el("h2", {}, "Create account"),
          field("Name", name),
          field("Email", email),
          field("Password", password),
          radios,
          clinicWrap,
          errorNote,
          submit,
          el("div", { class: "dialog-actions" }, closeBtn)
        );
        closeBtn.addEventListener("click", () => dialog.close());
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const body: Record<string, unknown> = {
            name: name.value,
            email: email.value,
            password: password.value,
            kind: clinic.checked ? "clinic" : "practitioner",
          };
          if (clinic.checked) body.clinic_name = clinicName.value;
          try {
            await api("/api/auth/signup", { method: "POST", body: JSON.stringify(body) });
            await refreshMe();
            accountCreated = true;
            dialog.close();
          } catch (e) {
            if (e instanceof ApiFailure && e.body.errors) {
              errorNote.hidden = false;
              errorNote.textContent = Object.values(e.body.errors)[0] ?? e.body.message;
            } else if (e instanceof ApiFailure) {
              errorNote.hidden = false;
              errorNote.textContent = e.body.message;
            }
          }
        });
        return form;
      },
      onClose: () => {
        if (accountCreated && onSignedIn) onSignedIn();
      },
    });
  }

  // ---------- Scene wiring ----------

  function initScene(): void {
    if (sceneMode !== "scene" || !sceneWrap) return;
    const preloader = el("div", { class: "preloader" });
    const progress = el("progress", { value: "0", max: "100", "aria-label": "Loading the lab" }) as HTMLProgressElement;
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", "Loading the lab");
    const label = el("span", { class: "label" }, "Loading the lab");
    preloader.append(progress, label);
    sceneWrap.append(preloader);

    let value = 0;
    const step = () => {
      value = Math.min(100, value + Math.ceil(Math.random() * 14));
      progress.value = value;
      if (value >= 100) {
        preloader.remove();
        sceneRegion.setAttribute("data-ready", "true");
      } else {
        window.setTimeout(step, 60);
      }
    };
    window.setTimeout(step, 60);

    scene = new LabScene(sceneWrap, sceneRegion, (label) => {
      const opener = benchButtons.get(label) ?? document.getElementById("reserve") ?? sceneRegion;
      onBenchActivate(label, opener);
    });
  }

  initScene();

  // Scroll-driven camera from overhead plan to bench height.
  const onScroll = () => {
    if (sceneMode !== "scene" || !scene) return;
    const rect = root.getBoundingClientRect();
    const vh = window.innerHeight;
    const progress = (vh - rect.top) / (vh + rect.height);
    scene.setScrollProgress(progress);
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  // Escape in the map or the hold panel releases the hold (or clears the
  // clinic selection).
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const inMap = event.target instanceof HTMLElement && (event.target.closest("#chapter-lab") !== null);
    if (!inMap) return;
    if (isClinic() && selection.length > 0) {
      selection = [];
      renderMap();
      return;
    }
    if (hold && !panelPinned) {
      releaseHold();
    }
  };
  window.addEventListener("keydown", onKeydown);

  function refresh(): void {
    const benches = state.benches;
    if (!benches) return;
    // Atelier sold-out banner and radio label.
    const soldOut = benches.tiers.atelier.sold_out;
    soldOutLabel.hidden = !soldOut;
    soldOutBanner.hidden = !(soldOut && tier === "atelier");
    if (!soldOutBanner.hidden) {
      clear(soldOutBanner);
      soldOutBanner.append(
        el("h4", {}, "Atelier is sold out"),
        el("p", {}, "All 10 Atelier places are taken. Join the Atelier waitlist and we will offer you the next Atelier bench that opens.")
      );
    }
    renderMap();
    // If a live hold of ours was reported released, show the hold-ended dialog.
    if (hold && !panelPinned && !pendingRequest) {
      const stillHeld = benches.benches.some((b) => b.state === "held_by_you");
      if (!stillHeld && !hold.holdEndedShown) {
        hold.holdEndedShown = true;
        const benchLabel = hold.reservations.map((r) => r.bench).join(", ");
        hold = null;
        openDialog({
          label: "Hold ended",
          build: (dialog) => {
            const wrap = el("div", {});
            wrap.append(
              el("h2", {}, "Your hold has ended"),
              el("p", {}, `Bench ${benchLabel} is back on the map. Pick another bench or join the waitlist.`),
              el("button", { class: "btn btn-live" }, "Back to the map")
            );
            wrap.querySelector("button")?.addEventListener("click", () => dialog.close());
            return wrap;
          },
          onClose: () => {
            benchButtons.get(benchLabel)?.focus();
          },
        });
        announce("Bench updates", `Your hold on Bench ${benchLabel} has ended. ${benches.seats_remaining} of 24 seats remaining.`);
      }
    }
  }

  /** At phone widths the hold countdown and pay buttons sit in the docked
   * reserve bar; otherwise the bar shows the seats remaining and the reserve
   * button. */
  function renderDocked(): void {
    const benches = state.benches;
    if (!benches) return;
    clear(dockedBar);
    const mobile = window.innerWidth < 768;
    if (!mobile) {
      dockedBar.hidden = true;
      return;
    }
    dockedBar.hidden = false;
    if (hold && !panelPinned && !pendingRequest) {
      const benchLabel = hold.reservations.map((r) => r.bench).join(", ");
      const timer = el("span", { class: "time mono num", role: "timer", "aria-label": "Hold time remaining" }, mmss((hold.expiresAt - Date.now()) / 1000));
      const tick = () => {
        if (!hold) return;
        timer.textContent = mmss((hold.expiresAt - Date.now()) / 1000);
        if (hold) window.setTimeout(tick, 250);
      };
      tick();
      dockedBar.append(
        el("span", { class: "seats" }, `Bench ${benchLabel} `, timer)
      );
      const actions = el("div", { style: "display:flex;gap:0.5rem" });
      if (hold.reservations.length === 1 && benches.deposits_open) {
        const payDeposit = el("button", { class: "btn btn-live" }, `Pay deposit $${money(hold.reservations[0]!.tier === "atelier" ? 150000 : 90000)}`);
        payDeposit.addEventListener("click", () => openCheckout(hold!.reservations[0]!, "deposit", payDeposit));
        actions.append(payDeposit);
      }
      if (hold.reservations.length === 1) {
        const payFull = el("button", { class: "btn btn-gold" }, `Pay in full $${money(hold.reservations[0]!.price_cents)}`);
        payFull.addEventListener("click", () => openCheckout(hold!.reservations[0]!, "full", payFull));
        actions.append(payFull);
      } else {
        const payGroup = el("button", { class: "btn btn-live" }, `Pay group invoice $${money(hold.reservations.reduce((s2, r) => s2 + r.price_cents, 0))}`);
        payGroup.addEventListener("click", () => openGroupCheckout(hold!.groupId!, hold!.reservations, payGroup));
        actions.append(payGroup);
      }
      const release = el("button", { class: "btn btn-quiet" }, "Release bench");
      release.addEventListener("click", () => releaseHold());
      actions.append(release);
      dockedBar.append(actions);
    } else {
      dockedBar.append(
        el("span", { class: "seats" }, el("strong", { class: "num" }, String(benches.seats_remaining)), " of 24 seats remaining"),
        reserveButtonForDock()
      );
    }
  }

  function reserveButtonForDock(): HTMLElement {
    const btn = el("button", { class: "btn btn-live", id: "reserve-docked" }, "Reserve a bench");
    btn.addEventListener("click", () => scrollToLab());
    return btn;
  }

  function scrollToLab(): void {
    const lab = document.getElementById("chapter-lab");
    lab?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    const focusBench = document.querySelector<HTMLElement>(".bench-btn[tabindex='0']");
    window.setTimeout(() => focusBench?.focus(), reduced ? 0 : 350);
  }

  // The waitlist button shows only while the tier has no bench to hold.
  function updateWaitlistButton(): void {
    const benches = state.benches;
    if (!benches) return;
    if (tier === "atelier" && benches.tiers.atelier.sold_out) {
      waitlistBtn.textContent = "Join the Atelier waitlist";
    } else if (tier === "bench" && benches.tiers.bench.remaining === 0) {
      waitlistBtn.textContent = "Join the Bench waitlist";
    } else {
      waitlistBtn.hidden = true;
      if (waitlistBtn.parentElement) waitlistBtn.remove();
      return;
    }
    waitlistBtn.hidden = !!state.me?.waitlist;
    if (!waitlistBtn.parentElement) {
      benchCol.insertBefore(waitlistBtn, mapWrap);
    }
  }

  waitlistBtn.addEventListener("click", async () => {
    try {
      const res = await api<{ tier: string; position: number }>("/api/waitlist", {
        method: "POST",
        body: JSON.stringify({ tier }),
      });
      announce("Bench updates", `You are number ${res.position} on the ${tier === "atelier" ? "Atelier" : "Bench"} waitlist.`);
      await refreshMe();
      updateWaitlistButton();
      emit();
    } catch (e) {
      if (e instanceof ApiFailure) announce("Bench updates", e.body.message);
    }
  });

  benchRadio.addEventListener("change", () => {
    if (benchRadio.checked) {
      tier = "bench";
      renderMap();
      updatePanel();
      updateWaitlistButton();
      refresh();
    }
  });
  atelierRadio.addEventListener("change", () => {
    if (atelierRadio.checked) {
      tier = "atelier";
      renderMap();
      updatePanel();
      updateWaitlistButton();
      refresh();
    }
  });

  const fullRefresh = () => {
    refresh();
    updateWaitlistButton();
    renderDocked();
    // Reconcile the hold with the server on each poll.
    if (hold && !panelPinned) {
      const mine = state.benches?.benches.find((b) => b.state === "held_by_you");
      if (!mine) {
        // The server may still confirm within two seconds; the countdown keeps
        // running and the poll will pick up the release.
      }
    }
  };

  return { root, refresh: fullRefresh };
}
