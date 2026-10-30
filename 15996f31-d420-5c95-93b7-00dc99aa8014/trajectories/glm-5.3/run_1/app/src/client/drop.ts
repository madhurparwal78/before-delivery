import { api, problemOf } from "./api.ts";
import type { Drop, User } from "./api.ts";
import { announceProblem, announceUpdate, busyButton, clear, clearFieldErrors, h, openDialog, showFieldErrors } from "./ui.ts";
import { DROP_STATUS_LABELS, formatDateText, formatMoney } from "./format.ts";
import { tierLabel } from "./odometer.ts";

/**
 * Drop detail at `/desk/drops/<id>`: the yard, hives, block, delivery date,
 * status, sampled colonies with photos, the block's tier, pay per hive and
 * expected pay, plus the role's action buttons.
 */
export async function renderDrop(app: HTMLElement, dropId: string): Promise<void> {
  let user: User;
  try {
    const me = await api<{ user: User }>("/api/me");
    user = me.body.user;
  } catch (error) {
    if (problemOf(error)?.status === 401) {
      announceProblem("Your session has ended. Sign in again.");
    }
    window.history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }
  let drop: Drop;
  try {
    const response = await api<Drop>(`/api/drops/${dropId}`);
    drop = response.body;
  } catch {
    clear(app);
    app.append(h("main", { class: "drop-wrap" }, h("h1", { text: "Drop" }), h("p", { text: "That record isn't available to you." })));
    return;
  }

  clear(app);
  const isBroker = user.role === "broker";
  const wrap = h("main", { class: "drop-wrap" });
  wrap.append(h("p", {},
    h("a", { href: "/desk", text: "Back to the desk" })));
  wrap.append(h("h1", { text: `${drop.yard_name}, ${drop.hives} hives` }));

  const facts = h("dl", { class: "facts" });
  const fact = (label: string, value: string): void => {
    facts.append(h("dt", { text: label }), h("dd", { text: value }));
  };
  fact("Order", drop.order.ref);
  fact("Orchard", drop.orchard.name);
  fact("Yard", drop.yard_name);
  fact("Hives", String(drop.hives));
  fact("Block", drop.block?.name ?? "—");
  fact("Delivery date", drop.delivered_on ? formatDateText(drop.delivered_on) : "—");
  fact("Status", DROP_STATUS_LABELS[drop.status] ?? drop.status);
  fact("Block tier", drop.tier ? tierLabel(drop.tier) : "—");
  fact("Pay per hive", drop.pay_per_hive_cents == null ? "—" : formatMoney(drop.pay_per_hive_cents));
  fact("Expected pay", drop.payout_cents == null ? "—" : formatMoney(drop.payout_cents));
  if (drop.dispute_reason) fact("Dispute reason", drop.dispute_reason);
  if (drop.resolution_note) fact("Resolution note", drop.resolution_note);
  wrap.append(facts);

  const photosArea = h("section", {},
    h("h2", { text: "Frame photos" }),
  );
  const list = h("ul", { class: "photo-grid", "aria-label": "Frame photos" });
  if (drop.photos.length === 0) {
    photosArea.append(h("p", { class: "empty", text: "No frame photos for this drop." }));
  } else {
    for (const photo of drop.photos) {
      list.append(h("li", {},
        h("a", { href: photo.url, text: `Photo, colony ${photo.colony_label}`, "aria-label": `Photo, colony ${photo.colony_label}` },
          h("img", { src: photo.url, alt: `Frame photo for colony ${photo.colony_label}` }))));
    }
    photosArea.append(list);
  }
  wrap.append(photosArea);

  if (drop.average_frames !== null) {
    wrap.append(h("p", { class: "num", text: `Sampled colonies average ${drop.average_frames.toFixed(1)} frames of bees.` }));
  }

  const actions = h("div", { class: "ledger-actions" });
  if (!isBroker && drop.status === "inspected") {
    const accept = h("button", { type: "button", class: "primary", text: "Accept inspection" });
    accept.addEventListener("click", async () => {
      const restore = busyButton(accept);
      announceUpdate("Accepting inspection…");
      try {
        await api(`/api/drops/${drop.id}/accept`, { method: "POST", body: {} });
        announceUpdate(`Inspection accepted for ${drop.yard_name}.`);
        restore();
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch (error) {
        restore();
        announceProblem(failureMessage(error, drop));
      }
    });
    actions.append(accept);
    const dispute = h("button", { type: "button", text: "Dispute inspection" });
    dispute.addEventListener("click", () => {
      const reason = h("textarea", { "data-field": "reason", id: "dispute-reason", rows: "4" });
      const submit = h("button", { type: "submit", class: "primary", text: "Send dispute" });
      const form = h("form", { novalidate: "" },
        h("h2", { text: "Dispute inspection" }),
        h("div", { class: "field" }, h("label", { for: "dispute-reason", text: "Reason" }), reason),
        h("div", { class: "dialog-actions" }, submit),
      );
      const dialog = openDialog({ label: "Dispute inspection", content: [form], opener: dispute });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearFieldErrors(form);
        const restore = busyButton(submit);
        announceUpdate("Sending dispute…");
        try {
          await api(`/api/drops/${drop.id}/dispute`, { method: "POST", body: { reason: reason.value } });
          announceUpdate("Dispute sent to the broker.");
          restore();
          dialog.close();
          dispute.focus();
          window.dispatchEvent(new PopStateEvent("popstate"));
        } catch (error) {
          restore();
          const problem = failure(error);
          if (problem?.fields && Object.keys(problem.fields).length > 0) {
            showFieldErrors(form, problem.fields);
          } else {
            announceProblem(failureMessage(error, drop));
          }
        }
      });
    });
    actions.append(dispute);
  }
  if (isBroker && drop.status === "disputed") {
    const resolve = h("button", { type: "button", class: "primary", text: "Resolve dispute" });
    resolve.addEventListener("click", () => {
      const note = h("textarea", { "data-field": "note", id: "resolve-note", rows: "4" });
      const submit = h("button", { type: "submit", class: "primary", text: "Resolve" });
      const form = h("form", { novalidate: "" },
        h("h2", { text: "Resolve dispute" }),
        h("div", { class: "field" }, h("label", { for: "resolve-note", text: "Resolution note" }), note),
        h("div", { class: "dialog-actions" }, submit),
      );
      const dialog = openDialog({ label: "Resolve dispute", content: [form], opener: resolve });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearFieldErrors(form);
        const restore = busyButton(submit);
        announceUpdate("Resolving dispute…");
        try {
          await api(`/api/drops/${drop.id}/resolve`, { method: "POST", body: { note: note.value } });
          announceUpdate(`Dispute resolved. ${drop.yard_name} is accepted.`);
          restore();
          dialog.close();
          resolve.focus();
          window.dispatchEvent(new PopStateEvent("popstate"));
        } catch (error) {
          restore();
          const problem = failure(error);
          if (problem?.fields && Object.keys(problem.fields).length > 0) {
            showFieldErrors(form, problem.fields);
          } else {
            announceProblem(failureMessage(error, drop));
          }
        }
      });
    });
    actions.append(resolve);
  }
  wrap.append(actions);
  app.append(wrap);
}

function failure(error: unknown): { fields?: Record<string, string>; code?: string; message?: string; status?: number } | null {
  if (error && typeof error === "object" && "status" in error) {
    return error as { fields?: Record<string, string>; code?: string; message?: string; status?: number };
  }
  return null;
}

function failureMessage(error: unknown, drop: Drop): string {
  const problem = failure(error);
  if (!problem) return "Bloom Desk can't reach its server. Check your connection and try again.";
  if (problem.status === 401) return "Your session has ended. Sign in again.";
  if (problem.status === 404) return "That record isn't available to you.";
  if (problem.status === 409) return `That can't be done while this drop is ${DROP_STATUS_LABELS[drop.status] ?? drop.status}.`;
  if ((problem.status ?? 0) >= 500) return "Something went wrong on our side. Try again in a minute.";
  return problem.message ?? "Something went wrong. Try again.";
}
