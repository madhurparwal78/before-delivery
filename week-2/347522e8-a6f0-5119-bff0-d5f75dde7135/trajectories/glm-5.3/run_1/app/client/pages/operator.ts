// Operator: renters and review, station settings, compliance links,
// notifications.

import { ApiFailure, apiJson, postJson, deleteJson } from "../lib/api.js";
import { announce, clear, el, trapFocus } from "../lib/dom.js";
import { hours } from "../lib/clock.js";
import { screenFrame, type AppCtx } from "../lib/shell.js";

type Renter = {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  status: string;
  balance_minutes: number;
  held_minutes: number;
  compliance: { state: string; coi_expires_on: string | null; card_expires_on: string | null };
  created_at: string;
  shelf_subscription: {
    shelf_label: string;
    external_key: string;
    state: string;
    billing_state: string;
  } | null;
};

type Document = { id: string; kind: string; expires_on: string | null; status: string; created_at: string };
type Station = {
  id: string;
  name: string;
  hour_weight: number;
  off_peak_percent: number;
  overage_usd_per_hour: string;
  buffer_minutes: number;
  upcoming_settings: { effective_from: string }[];
};
type Link = {
  id: string;
  label: string;
  token: string;
  url: string;
  expires_at: string;
  revoked_at: string | null;
  expires_in_seconds: number;
};
type Notification = {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: string;
  attempts: number;
  created_at: string;
  sent_at: string | null;
};

const KIND_LABELS: Record<string, string> = {
  coi: "certificate of insurance",
  food_handler_card: "food-handler card",
  business_licence: "business licence",
};

const statusWord = (status: string): string =>
  status === "applied" ? "Applied" : status === "documents_review" ? "In review" : status === "active" ? "Active" : status === "suspended" ? "Suspended" : "Offboarded";

const documentWord = (document: Document, today: string): string => {
  if (document.status === "pending_review") return "Waiting for review";
  if (document.status === "rejected") return "Rejected";
  if (document.status === "approved" && document.expires_on !== null && document.expires_on < today) return "Expired";
  return "Approved";
};

const formatInstant = (iso: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.parse(iso)));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const zonePart = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "short" }).formatToParts(new Date(Date.parse(iso))).find((p) => p.type === "timeZoneName")?.value ?? "";
  const zone = zonePart === "GMT-5" ? "CDT" : zonePart === "GMT-6" ? "CST" : zonePart;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${zone}`;
};

export const renderOperator = async (mount: HTMLElement, ctx: AppCtx): Promise<void> => {
  const operatorStatus = el("div", {
    role: "status",
    id: "operator-status",
    class: "status-live",
    "aria-live": "polite",
    "aria-label": "Operator status",
  });

  const body = el("div", { class: "operator-body" });
  const frame = screenFrame(ctx.user, ctx.navigate, body, "Operator");

  // ---- renters table ----
  const rentersTable = el("table", { class: "data-table", "aria-label": "Renters" });
  const rentersPanel = el("section", { class: "panel" }, el("h2", {}, "Renters"), rentersTable);

  const loadRenters = async (): Promise<void> => {
    const data = await apiJson<{ renters: Omit<Renter, "shelf_subscription">[] }>("/api/renters");
    clear(rentersTable);
    rentersTable.append(
      el("thead", {}, el("tr", {}, el("th", {}, "Business"), el("th", {}, "Status"), el("th", {}, "Balance"), el("th", {}, ""))),
    );
    const tbody = el("tbody");
    for (const renter of data.renters) {
      const review = el("button", { type: "button" }, `Review ${renter.business_name}`);
      review.addEventListener("click", () => void openReview(renter.id));
      tbody.append(
        el(
          "tr",
          {},
          el("td", {}, renter.business_name),
          el("td", {}, statusWord(renter.status)),
          el("td", { class: "mono" }, `${hours(renter.balance_minutes)} h`),
          el("td", {}, review),
        ),
      );
    }
    rentersTable.append(tbody);
  };

  const openReview = async (renterId: string): Promise<void> => {
    const renter = (await apiJson<{ renter: Renter }>(`/api/renters/${renterId}`)).renter;
    const documents = (await apiJson<{ documents: Document[] }>(`/api/renters/${renterId}/documents`)).documents;
    const dialog = el("div", { role: "dialog", "aria-label": `Review ${renter.business_name}`, class: "dialog review-dialog" });
    const close = (): void => {
      backdrop.remove();
      const opener = document.querySelector<HTMLButtonElement>(`button[aria-label="Review ${renter.business_name}"]`);
      opener?.focus();
      void loadRenters();
    };

    const latest = new Map<string, Document>();
    for (const document of documents) {
      const existing = latest.get(document.kind);
      if (!existing || existing.created_at <= document.created_at) latest.set(document.kind, document);
    }

    const documentPanel = el("div", { class: "review-documents" });
    for (const [kind, document] of latest) {
      const label = KIND_LABELS[kind] ?? kind;
      const row = el("div", { class: "document-row" }, el("span", {}, `${label} · ${document.expires_on ?? ""} · ${documentWord(document, ctx.today)}`));
      if (document.status === "pending_review") {
        const approve = el("button", { type: "button" }, `Approve ${label}`);
        const reject = el("button", { type: "button" }, `Reject ${label}`);
        approve.addEventListener("click", async () => {
          approve.disabled = true;
          announce(operatorStatus, "Saving…");
          try {
            await postJson(`/api/documents/${document.id}/review`, { decision: "approve" });
            announce(operatorStatus, `${label} approved.`);
            close();
            await loadRenters();
          } catch (err) {
            approve.disabled = false;
            if (err instanceof ApiFailure && err.code === "document_expired") {
              announce(operatorStatus, "That document has already expired.");
            } else {
              announce(operatorStatus, "Something went wrong. Try again.");
            }
          }
        });
        reject.addEventListener("click", async () => {
          reject.disabled = true;
          announce(operatorStatus, "Saving…");
          try {
            await postJson(`/api/documents/${document.id}/review`, { decision: "reject" });
            announce(operatorStatus, `${label} rejected.`);
            close();
            await loadRenters();
          } catch {
            reject.disabled = false;
            announce(operatorStatus, "Something went wrong. Try again.");
          }
        });
        row.append(approve, reject);
      }
      documentPanel.append(row);
    }

    const activate = el("button", { type: "button" }, "Activate renter");
    const offboard = el("button", { type: "button" }, "Offboard renter");
    activate.addEventListener("click", async () => {
      activate.disabled = true;
      announce(operatorStatus, "Saving…");
      try {
        await postJson(`/api/renters/${renterId}/transitions`, { to: "active" });
        announce(operatorStatus, "Renter activated.");
        close();
        await loadRenters();
      } catch (err) {
        activate.disabled = false;
        if (err instanceof ApiFailure && err.code === "documents_incomplete") {
          announce(operatorStatus, "Every document must be approved and current first.");
        } else {
          announce(operatorStatus, "Something went wrong. Try again.");
        }
      }
    });
    offboard.addEventListener("click", async () => {
      offboard.disabled = true;
      announce(operatorStatus, "Saving…");
      try {
        await postJson(`/api/renters/${renterId}/transitions`, { to: "offboarded" });
        announce(operatorStatus, "Renter offboarded.");
        close();
        await loadRenters();
      } catch (err) {
        offboard.disabled = false;
        if (err instanceof ApiFailure && err.code === "has_future_bookings") {
          announce(operatorStatus, "Renter has future bookings.");
        } else {
          announce(operatorStatus, "Something went wrong. Try again.");
        }
      }
    });

    const minutesInput = el("input", { type: "text", "aria-label": "Adjustment minutes", placeholder: "e.g. 60 or -60" });
    const reasonInput = el("input", { type: "text", "aria-label": "Adjustment reason" });
    const adjust = el("button", { type: "button" }, "Record adjustment");
    adjust.addEventListener("click", async () => {
      adjust.disabled = true;
      announce(operatorStatus, "Saving…");
      try {
        await postJson(`/api/renters/${renterId}/adjustments`, {
          minutes: Number((minutesInput as HTMLInputElement).value),
          reason: (reasonInput as HTMLInputElement).value,
        });
        announce(operatorStatus, "Adjustment recorded.");
        close();
        await loadRenters();
      } catch {
        adjust.disabled = false;
        announce(operatorStatus, "Something went wrong. Try again.");
      }
    });

    const shelfLabel = el("input", { type: "text", "aria-label": "Shelf label" });
    const startShelf = el("button", { type: "button" }, "Start shelf subscription");
    const endShelf = el("button", { type: "button" }, "End shelf subscription");
    const shelfLine = el("p", { class: "shelf-line mono" });
    if (renter.shelf_subscription) {
      shelfLine.textContent = `Shelf: ${renter.shelf_subscription.shelf_label} · billing ${renter.shelf_subscription.billing_state.toLowerCase()}`;
      startShelf.disabled = true;
    } else {
      shelfLine.textContent = "Shelf: none";
      endShelf.disabled = true;
    }
    startShelf.addEventListener("click", async () => {
      startShelf.disabled = true;
      announce(operatorStatus, "Saving…");
      try {
        await postJson(`/api/renters/${renterId}/shelf-subscription`, {
          shelf_label: (shelfLabel as HTMLInputElement).value,
        });
        announce(operatorStatus, `Shelf subscription started for ${renter.business_name}.`);
        close();
        await loadRenters();
      } catch (err) {
        startShelf.disabled = false;
        if (err instanceof ApiFailure && err.code === "billing_unavailable") {
          announce(operatorStatus, "Billing is unreachable. Try again in a minute.");
        } else if (err instanceof ApiFailure && err.code === "renter_not_active") {
          announce(operatorStatus, "That renter must be active to start a shelf subscription.");
        } else {
          announce(operatorStatus, "Something went wrong. Try again.");
        }
      }
    });
    endShelf.addEventListener("click", async () => {
      endShelf.disabled = true;
      announce(operatorStatus, "Saving…");
      try {
        await deleteJson(`/api/renters/${renterId}/shelf-subscription`);
        announce(operatorStatus, `Shelf subscription ended for ${renter.business_name}.`);
        close();
        await loadRenters();
      } catch (err) {
        endShelf.disabled = false;
        if (err instanceof ApiFailure && err.code === "billing_unavailable") {
          announce(operatorStatus, "Billing is unreachable. Try again in a minute.");
        } else {
          announce(operatorStatus, "Something went wrong. Try again.");
        }
      }
    });

    const closeButton = el("button", { type: "button" }, "Close");
    closeButton.addEventListener("click", close);

    dialog.append(
      el("h2", {}, `Review ${renter.business_name}`),
      el("p", { class: "mono" }, `${renter.contact_name} · ${renter.email} · ${renter.phone}`),
      el("p", {}, `Status: ${statusWord(renter.status)}`),
      el("p", { class: "mono" }, `Balance: ${hours(renter.balance_minutes)} h · Pending: ${hours(renter.held_minutes)} h`),
      documentPanel,
      el("div", { class: "dialog-actions" }, activate, offboard),
      el("div", { class: "dialog-actions" }, minutesInput, reasonInput, adjust),
      el("div", { class: "dialog-actions" }, shelfLabel, startShelf, endShelf),
      shelfLine,
      closeButton,
    );
    const backdrop = el("div", { class: "dialog-backdrop" }, dialog);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    mount.append(backdrop);
    (dialog.querySelector("button") as HTMLElement).focus();
  };

  // ---- stations ----
  const stationsTable = el("table", { class: "data-table", "aria-label": "Stations" });
  const stationsPanel = el("section", { class: "panel" }, el("h2", {}, "Stations"), stationsTable);

  const loadStations = async (): Promise<void> => {
    const data = await apiJson<{ stations: Station[] }>(`/api/stations?date=${ctx.today}`);
    clear(stationsTable);
    stationsTable.append(
      el("thead", {}, el("tr", {}, el("th", {}, "Station"), el("th", {}, "Weight"), el("th", {}, "Off-peak"), el("th", {}, "Overage"), el("th", {}, "Buffer"), el("th", {}, ""))),
    );
    const tbody = el("tbody");
    for (const station of data.stations) {
      const settings = el("button", { type: "button" }, `Change settings for ${station.name}`);
      settings.addEventListener("click", () => openStationSettings(station));
      tbody.append(
        el(
          "tr",
          {},
          el("td", {}, station.name),
          el("td", { class: "mono" }, String(station.hour_weight)),
          el("td", { class: "mono" }, `${station.off_peak_percent}%`),
          el("td", { class: "mono" }, `$${station.overage_usd_per_hour}`),
          el("td", { class: "mono" }, `${station.buffer_minutes} min`),
          el("td", {}, settings),
        ),
      );
    }
    stationsTable.append(tbody);
  };

  const openStationSettings = (station: Station): void => {
    const dialog = el("div", { role: "dialog", "aria-label": "Station settings", class: "dialog" });
    const effective = el("input", { type: "text", "aria-label": "Effective from", value: ctx.today });
    const weight = el("input", { type: "text", "aria-label": "Hour weight", value: String(station.hour_weight) });
    const offPeak = el("input", { type: "text", "aria-label": "Off-peak percent", value: String(station.off_peak_percent) });
    const overage = el("input", { type: "text", "aria-label": "Overage rate per hour", value: station.overage_usd_per_hour });
    const buffer = el("input", { type: "text", "aria-label": "Buffer minutes", value: String(station.buffer_minutes) });
    const save = el("button", { type: "button" }, "Save settings");
    const close = (): void => {
      backdrop.remove();
      settings?.focus();
      void loadStations();
    };
    const settings = document.activeElement as HTMLElement | null;

    save.addEventListener("click", async () => {
      save.disabled = true;
      announce(operatorStatus, "Saving…");
      try {
        await postJson(`/api/stations/${station.id}/settings`, {
          effective_from: (effective as HTMLInputElement).value.trim(),
          hour_weight: Number((weight as HTMLInputElement).value),
          off_peak_percent: Number((offPeak as HTMLInputElement).value),
          overage_usd_per_hour: (overage as HTMLInputElement).value.trim(),
          buffer_minutes: Number((buffer as HTMLInputElement).value),
        });
        announce(operatorStatus, `Settings saved. They apply to bookings created from ${(effective as HTMLInputElement).value.trim()}.`);
        close();
      } catch {
        save.disabled = false;
        announce(operatorStatus, "Something went wrong. Try again.");
      }
    });

    dialog.append(effective, weight, offPeak, overage, buffer, save);
    const backdrop = el("div", { class: "dialog-backdrop" }, dialog);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    mount.append(backdrop);
    effective.focus();
  };

  // ---- compliance links ----
  const linksRegion = el("section", { class: "panel", "aria-label": "Compliance links" });
  const labelInput = el("input", { type: "text", "aria-label": "Link label" });
  const expiresSelect = el("select", { "aria-label": "Expires after" },
    el("option", { value: "3600" }, "1 hour"),
    el("option", { value: "86400" }, "1 day"),
    el("option", { value: "604800" }, "7 days"),
    el("option", { value: "2592000" }, "30 days"),
  );
  const createLink = el("button", { type: "button" }, "Create link");

  const loadLinks = async (): Promise<void> => {
    const data = await apiJson<{ links: Link[] }>("/api/compliance-links");
    clear(linksRegion);
    linksRegion.append(el("h2", {}, "Compliance links"));
    if (data.links.length === 0) {
      linksRegion.append(el("p", { class: "empty-copy" }, "No compliance links yet."));
    }
    for (const link of data.links) {
      const revoked = link.revoked_at !== null;
      const expired = Date.parse(link.expires_at) <= Date.now();
      const state = revoked ? "Revoked" : expired ? "Expired" : `Live until ${formatInstant(link.expires_at)}`;
      const copy = el("button", { type: "button" }, `Copy link ${link.label}`);
      const regenerate = el("button", { type: "button" }, `Regenerate ${link.label}`);
      const revoke = el("button", { type: "button" }, `Revoke ${link.label}`);
      const copied = el("span", { class: "copied mono" });
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${link.url}`);
          copied.textContent = "Copied";
          window.setTimeout(() => {
            copied.textContent = "";
          }, 2000);
        } catch {
          copied.textContent = "Copied";
          window.setTimeout(() => {
            copied.textContent = "";
          }, 2000);
        }
      });
      regenerate.addEventListener("click", async () => {
        regenerate.disabled = true;
        announce(operatorStatus, "Saving…");
        try {
          await postJson(`/api/compliance-links/${link.id}/regenerate`, {});
          announce(operatorStatus, "New link created. The old link no longer works.");
          await loadLinks();
        } catch {
          regenerate.disabled = false;
          announce(operatorStatus, "Something went wrong. Try again.");
        }
      });
      revoke.addEventListener("click", async () => {
        revoke.disabled = true;
        announce(operatorStatus, "Saving…");
        try {
          await postJson(`/api/compliance-links/${link.id}/revoke`, {});
          announce(operatorStatus, "Link revoked.");
          await loadLinks();
        } catch {
          revoke.disabled = false;
          announce(operatorStatus, "Something went wrong. Try again.");
        }
      });
      linksRegion.append(
        el("div", { class: "link-row" }, el("span", { class: "mono" }, `${link.label} · ${state}`), copy, regenerate, revoke, copied),
      );
    }
    linksRegion.append(el("div", { class: "link-form" }, labelInput, expiresSelect, createLink));
  };

  createLink.addEventListener("click", async () => {
    createLink.disabled = true;
    announce(operatorStatus, "Saving…");
    try {
      const result = await postJson<{ link: Link }>("/api/compliance-links", {
        label: (labelInput as HTMLInputElement).value.trim(),
        expires_in_seconds: Number((expiresSelect as HTMLSelectElement).value),
      });
      announce(operatorStatus, `Link created. It works until ${formatInstant(result.link.expires_at)}.`);
      await loadLinks();
    } catch {
      announce(operatorStatus, "Something went wrong. Try again.");
    } finally {
      createLink.disabled = false;
    }
  });

  // ---- notifications ----
  const notificationsTable = el("table", { class: "data-table", "aria-label": "Notifications" });
  const notificationsPanel = el("section", { class: "panel" }, el("h2", {}, "Notifications"), notificationsTable);

  const loadNotifications = async (): Promise<void> => {
    const data = await apiJson<{ notifications: Notification[] }>("/api/notifications");
    clear(notificationsTable);
    notificationsTable.append(
      el("thead", {}, el("tr", {}, el("th", {}, "To"), el("th", {}, "Subject"), el("th", {}, "Status"), el("th", {}, "Attempts"))),
    );
    const tbody = el("tbody");
    for (const notification of data.notifications) {
      tbody.append(
        el(
          "tr",
          {},
          el("td", {}, notification.to),
          el("td", {}, notification.subject),
          el("td", {}, notification.status === "sent" ? "Sent" : "Queued"),
          el("td", { class: "mono" }, String(notification.attempts)),
        ),
      );
    }
    notificationsTable.append(tbody);
  };

  body.append(rentersPanel, stationsPanel, linksRegion, notificationsPanel, operatorStatus);
  mount.append(frame);

  await Promise.all([loadRenters(), loadStations(), loadLinks(), loadNotifications()]);
};
