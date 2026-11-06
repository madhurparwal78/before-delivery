// My seats: held and served seats with give-back and the verification form.
import { api, ApiCallError, el, formatRange, parseInstant } from "../lib";
import { pollWhileConnected, statusRegion } from "../components";
import { App } from "../main";
import type { HolderAssignmentView } from "../types";
import { languageName } from "./drawer";

interface SeatBlock {
  seatNo: number;
  card: HTMLLIElement;
  uploadStatus: { el: HTMLDivElement; set: (text: string) => void };
}

export function renderMySeats(app: App): void {
  const main = app.main;
  const list = el("ul", { "aria-label": "My seats", class: "cards" });
  const status = statusRegion("Claim status");
  main.append(
    el("h1", { text: "My seats" }),
    status.el,
    list,
  );

  const load = (): void => {
    api<{ assignments: HolderAssignmentView[] }>("GET", "/api/my-seats").then((res) => {
      list.replaceChildren();
      for (const a of res.assignments) {
        list.append(buildCard(a));
      }
    }).catch(() => {
      status.set("My seats not updating. Retrying…");
    });
  };

  const buildCard = (a: HolderAssignmentView): HTMLLIElement => {
    const card = el("li", { class: "card" });
    const uploadStatus = statusRegion("Upload status");
    card.append(
      el("h3", {}, el("span", { class: "num", text: a.number }), ` — ${languageName(a.language)}`),
      el("p", { text: `${a.setting} · ${a.city}` }),
      el("p", { text: formatRange(parseInstant(a.start_at)!, parseInstant(a.end_at)!) }),
      el("p", { text: `Street address: ${a.street_address}` }),
      el("p", { text: `Patient initials: ${a.patient_initials}` }),
      el("p", { text: `Medical notes: ${a.medical_notes || "—"}` }),
      el("p", { text: `Requested by ${a.scheduler.name} (${a.scheduler.phone})` }),
    );
    if (a.status === "cancelled") {
      card.append(el("p", { text: "This request was cancelled." }));
      return card;
    }
    card.append(uploadStatus.el);
    const seatsBlock = el("div", { class: "two-col", style: "margin-top: 10px;" });
    for (const seat of a.seats) {
      if (seat.status === "open") continue;
      seatsBlock.append(buildSeatActions(a, seat.seat, seat.status, { seatNo: seat.seat, card, uploadStatus }));
    }
    card.append(seatsBlock);
    return card;
  };

  const buildSeatActions = (a: HolderAssignmentView, seatNo: number, seatStatus: string, block: SeatBlock): HTMLElement => {
    const wrap = el("div", {});
    const viewFormLink = (): HTMLElement =>
      el("a", {
        href: "#",
        text: "View signed form",
        onclick: async (e: Event) => {
          e.preventDefault();
          try {
            const link = await api<{ url: string }>("GET", `/api/assignments/${a.number}/seats/${seatNo}/verification-link`);
            window.open(link.url, "_blank", "noopener");
          } catch {
            block.uploadStatus.set("File storage is unavailable. Try again shortly.");
          }
        },
      });
    if (seatStatus === "served") {
      wrap.append(el("p", { text: `Seat ${seatNo} verified` }), viewFormLink());
      return wrap;
    }
    const giveBackBtn = el("button", {
      class: "btn",
      text: `Give back seat ${seatNo} on ${a.number}`,
      onclick: async () => {
        giveBackBtn.disabled = true;
        status.set("Giving back…");
        try {
          await api("POST", `/api/assignments/${a.number}/seats/${seatNo}/give-back`, {});
          status.set(`Seat ${seatNo} on ${a.number} given back.`);
          load();
        } catch (err) {
          giveBackBtn.disabled = false;
          status.set(err instanceof ApiCallError && err.code === "invalid_transition"
            ? "This seat can no longer be given back."
            : "Couldn't reach Teamseat. Try again.");
        }
      },
    });
    const verifyLink = el("a", {
      href: "#",
      text: `Verify seat ${seatNo} on ${a.number}`,
      onclick: (e: Event) => {
        e.preventDefault();
        verifyLink.remove();
        openVerifyForm(a, seatNo, wrap, giveBackBtn, block);
      },
    });
    wrap.append(giveBackBtn, el("div", { style: "margin-top: 8px;" }, verifyLink));
    return wrap;
  };

  const openVerifyForm = (a: HolderAssignmentView, seatNo: number, wrap: HTMLElement, giveBackBtn: HTMLButtonElement, block: SeatBlock): void => {
    const minutes = el("input", { type: "number", min: "1", max: "960", id: `vm-${a.number}-${seatNo}` });
    const miles = el("input", { type: "number", min: "0", max: "1000", id: `ml-${a.number}-${seatNo}` });
    const file = el("input", { type: "file", id: `file-${a.number}-${seatNo}`, accept: "application/pdf,image/jpeg,image/png" });
    const form = el("form", { "aria-label": `Verify seat ${seatNo} on ${a.number}` },
      el("div", { class: "field" }, el("label", { for: minutes.id, text: "Actual minutes" }), minutes),
      el("div", { class: "field" }, el("label", { for: miles.id, text: "Round-trip miles" }), miles),
      el("div", { class: "field" }, el("label", { for: file.id, text: "Signed verification form" }), file),
      el("button", { class: "btn btn-primary", type: "submit", text: "Submit verification" }),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData();
      data.set("actual_minutes", minutes.value);
      data.set("round_trip_miles", miles.value);
      const chosen = (file as HTMLInputElement).files?.[0];
      if (chosen) data.set("form", chosen);
      block.uploadStatus.set("Uploading…");
      try {
        await api("POST", `/api/assignments/${a.number}/seats/${seatNo}/verification`, data);
        block.uploadStatus.set(`Verification for seat ${seatNo} received.`);
        giveBackBtn.remove();
        form.remove();
        wrap.append(el("p", { text: `Seat ${seatNo} verified` }));
        wrap.append(el("div", { style: "margin-top: 8px;" },
          (() => {
            const link = el("a", { href: "#", text: "View signed form" });
            link.addEventListener("click", async (ev) => {
              ev.preventDefault();
              try {
                const res = await api<{ url: string }>("GET", `/api/assignments/${a.number}/seats/${seatNo}/verification-link`);
                window.open(res.url, "_blank", "noopener");
              } catch {
                block.uploadStatus.set("File storage is unavailable. Try again shortly.");
              }
            });
            return link;
          })()));
      } catch (err) {
        if (err instanceof ApiCallError) {
          if (err.code === "payload_too_large") block.uploadStatus.set("The file is larger than 5,000,000 bytes.");
          else if (err.code === "validation") block.uploadStatus.set(err.fields.form ?? "Check the fields.");
          else if (err.code === "storage_unavailable") block.uploadStatus.set("File storage is unavailable. Your form was not saved. Try again shortly.");
          else if (err.code === "already_verified") block.uploadStatus.set("This seat is already verified.");
          else if (err.code === "invalid_transition") block.uploadStatus.set("This seat cannot be verified now.");
          else block.uploadStatus.set("Couldn't reach Teamseat. Try again.");
        } else {
          block.uploadStatus.set("Couldn't reach Teamseat. Try again.");
        }
      }
    });
    wrap.append(form);
    minutes.focus();
  };

  load();
  pollWhileConnected(main, load);
}

