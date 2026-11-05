import {
  COPY,
  formatLongDate,
  planChanged,
  planEnds,
  planPauses,
  previewReady,
} from "../shared/copy.js";
import { formatMoney, parseAmount, type Currency } from "../shared/money.js";
import { announce, api, pageData, qs, qsa, trapDialog, type ErrorBody } from "./dom.js";
import { QuoteSheet, changeFigures } from "./sheet.js";

interface PlanBody {
  id: string;
  tier: "lite" | "plus";
  planName: string;
  status: "active" | "paused" | "pending_cancel" | "past_due" | "cancelled";
  currency: Currency;
  monthlyPrice: string;
  periodStart: string | null;
  chargedThrough: string | null;
  pauseOn: string | null;
  endsOn: string | null;
}

interface PreviewBody {
  previewId: string;
  fromTier: "lite" | "plus";
  toTier: "lite" | "plus";
  currency: Currency;
  credit: string;
  charge: string;
  total: string;
  creditShare: string;
}

function statusLabel(plan: PlanBody): string {
  switch (plan.status) {
    case "active":
      return plan.pauseOn ? `Pauses on ${formatLongDate(plan.pauseOn)}` : "Active";
    case "paused":
      return "Paused";
    case "pending_cancel":
      return plan.endsOn ? `Ends on ${formatLongDate(plan.endsOn)}` : "Cancelled";
    case "past_due":
      return "Past due";
    default:
      return "Cancelled";
  }
}

function actionsMarkup(plan: PlanBody): string {
  const buttons: string[] = [];
  if (plan.status === "active" && !plan.pauseOn) {
    const other = plan.tier === "lite" ? "Care Plus" : "Care Lite";
    buttons.push(
      `<button type="button" data-switch-tier="${plan.tier === "lite" ? "plus" : "lite"}">Switch to ${other}</button>`,
    );
    buttons.push(`<button type="button" data-pause-plan>Pause plan</button>`);
    buttons.push(`<button type="button" data-cancel-open>Cancel plan</button>`);
  }
  if (plan.status === "paused" || (plan.status === "active" && plan.pauseOn)) {
    buttons.push(`<button type="button" data-resume-plan>Resume plan</button>`);
  }
  return buttons.join("");
}

export function initPlan(): void {
  const data = pageData<{ page: string }>();
  if (!data || data.page !== "plan") return;
  const status = qs<HTMLElement>("[data-plan-status]");
  const changeDialogRoot = qs<HTMLElement>("[data-change-dialog]");
  const cancelDialogRoot = qs<HTMLElement>("[data-cancel-dialog]");
  const sheetRegion = changeDialogRoot ? qs<HTMLElement>("[data-quote]", changeDialogRoot) : null;
  const sheet = sheetRegion ? new QuoteSheet(sheetRegion) : null;
  const confirmButton = qs<HTMLButtonElement>("[data-confirm-change]");
  let preview: PreviewBody | null = null;

  const changeDialog = changeDialogRoot
    ? trapDialog(changeDialogRoot, {
        onClose: () => {
          preview = null;
          if (confirmButton) confirmButton.disabled = true;
        },
      })
    : null;
  const cancelDialog = cancelDialogRoot ? trapDialog(cancelDialogRoot) : null;

  const dialogOpen = (): boolean => Boolean(changeDialog?.isOpen() || cancelDialog?.isOpen());

  const applyPlan = (plan: PlanBody): void => {
    const statusText = qs<HTMLElement>("[data-plan-status-text]");
    if (statusText) statusText.textContent = `Status: ${statusLabel(plan)}`;
    const periodStart = qs<HTMLElement>("[data-period-start]");
    if (periodStart) periodStart.textContent = plan.periodStart ?? "";
    const chargedThrough = qs<HTMLElement>("[data-charged-through]");
    if (chargedThrough) chargedThrough.textContent = plan.chargedThrough ?? "";
    const price = qs<HTMLElement>(".plan-price");
    const monthly = parseAmount(plan.currency, plan.monthlyPrice);
    if (price && monthly) price.textContent = `${formatMoney(monthly)} / month`;
    const heading = qs<HTMLElement>("h1");
    if (heading) heading.textContent = plan.planName;
    if (dialogOpen()) return;
    const actions = qs<HTMLElement>("[data-plan-actions]");
    if (actions) actions.innerHTML = actionsMarkup(plan);
  };

  const openPreview = async (toTier: "lite" | "plus"): Promise<void> => {
    changeDialog?.open();
    sheet?.quoting();
    if (confirmButton) confirmButton.disabled = true;
    announce(status, COPY.previewPending);
    const result = await api<PreviewBody & ErrorBody>("/api/plan/previews", {
      method: "POST",
      body: { tier: toTier },
    });
    if (result.status !== 201) {
      sheet?.outage(COPY.planChangeOutage);
      announce(status, result.status === 503 ? COPY.planChangeOutage : result.body.message);
      return;
    }
    preview = result.body;
    showPreview(result.body);
  };

  const showPreview = (body: PreviewBody): void => {
    sheet?.show(changeFigures(body));
    const credit = parseAmount(body.currency, body.credit);
    const charge = parseAmount(body.currency, body.charge);
    const total = parseAmount(body.currency, body.total);
    if (credit && charge && total) {
      announce(status, previewReady(formatMoney(credit), formatMoney(charge), formatMoney(total)));
    }
    if (confirmButton) confirmButton.disabled = false;
  };

  const refresh = async (): Promise<void> => {
    const result = await api<{ plan: PlanBody }>("/api/plan");
    if (result.status !== 200) {
      return;
    }
    applyPlan(result.body.plan);
  };

  document.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const switchButton = target.closest<HTMLElement>("[data-switch-tier]");
    if (switchButton) {
      const tier = switchButton.dataset.switchTier === "plus" ? "plus" : "lite";
      await openPreview(tier);
      return;
    }
    if (target.closest("[data-change-close]")) {
      changeDialog?.close();
      return;
    }
    if (target.closest("[data-confirm-change]")) {
      if (!preview) return;
      announce(status, COPY.planActionPending);
      const result = await api<{ plan: PlanBody; preview?: PreviewBody } & ErrorBody>("/api/plan/changes", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: { previewId: preview.previewId },
      });
      if (result.status === 200) {
        changeDialog?.close();
        applyPlan(result.body.plan);
        announce(status, planChanged(result.body.plan.planName));
        return;
      }
      if (result.status === 409 && result.body.error === "preview_stale" && result.body.preview) {
        preview = result.body.preview;
        showPreview(result.body.preview);
        announce(status, COPY.previewStale);
        return;
      }
      if (result.status === 409) {
        announce(status, COPY.previewExpired);
        return;
      }
      if (result.status === 402) {
        announce(status, COPY.cardDeclined);
        return;
      }
      announce(status, result.status === 503 ? COPY.planChangeOutage : result.body.message);
      return;
    }
    if (target.closest("[data-pause-plan]")) {
      announce(status, COPY.planActionPending);
      const result = await api<{ plan: PlanBody } & ErrorBody>("/api/plan/pause", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: {},
      });
      if (result.status === 200) {
        applyPlan(result.body.plan);
        announce(
          status,
          result.body.plan.pauseOn ? planPauses(formatLongDate(result.body.plan.pauseOn)) : COPY.planActionPending,
        );
        return;
      }
      announce(status, result.status === 503 ? COPY.planChangeOutage : result.body.message);
      return;
    }
    if (target.closest("[data-resume-plan]")) {
      announce(status, COPY.planActionPending);
      const result = await api<{ plan: PlanBody } & ErrorBody>("/api/plan/resume", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: {},
      });
      if (result.status === 200) {
        applyPlan(result.body.plan);
        announce(status, COPY.planResumed);
        return;
      }
      if (result.status === 402) {
        announce(status, COPY.cardDeclined);
        return;
      }
      announce(status, result.status === 503 ? COPY.planChangeOutage : result.body.message);
      return;
    }
    if (target.closest("[data-cancel-open]")) {
      cancelDialog?.open();
      return;
    }
    if (target.closest("[data-cancel-close]")) {
      cancelDialog?.close();
      return;
    }
    if (target.closest("[data-cancel-confirm]")) {
      announce(status, COPY.planActionPending);
      const result = await api<{ plan: PlanBody } & ErrorBody>("/api/plan/cancel", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: {},
      });
      if (result.status === 200) {
        cancelDialog?.close();
        applyPlan(result.body.plan);
        announce(
          status,
          result.body.plan.endsOn ? planEnds(formatLongDate(result.body.plan.endsOn)) : COPY.planActionPending,
        );
        return;
      }
      announce(status, result.status === 503 ? COPY.planChangeOutage : result.body.message);
    }
  });

  const cardForm = qs<HTMLFormElement>("[data-card-form]");
  cardForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    announce(status, COPY.payPending);
    const result = await api<{ plan: PlanBody } & ErrorBody>("/api/plan/card", {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      body: {
        card: {
          number: qs<HTMLInputElement>('[name="cardNumber"]', cardForm)?.value ?? "",
          expiry: qs<HTMLInputElement>('[name="cardExpiry"]', cardForm)?.value ?? "",
          cvc: qs<HTMLInputElement>('[name="cardCvc"]', cardForm)?.value ?? "",
        },
      },
    });
    if (result.status === 200) {
      applyPlan(result.body.plan);
      for (const node of qsa<HTMLElement>('[role="alert"]')) node.remove();
      cardForm.hidden = true;
      announce(status, COPY.cardUpdatePaid);
      return;
    }
    if (result.status === 402) {
      announce(status, COPY.cardDeclined);
      return;
    }
    if (result.status === 503) {
      announce(status, COPY.billingOutage);
      return;
    }
    announce(status, result.body.message);
  });

  window.setInterval(() => void refresh(), 15_000);
}
