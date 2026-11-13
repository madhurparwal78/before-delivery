import { el, api } from "./dom.js";
import { announcementsRegion } from "./shell.js";
import { navigate } from "./router.js";
import { announce, formatDate, formatInstant, formatMoney } from "./motion.js";
import { openDialog, clearProblems, problemsRegion } from "./dialogs.js";
import { memberNav } from "./nav.js";
import type { MembershipView } from "../shared/views.js";
import { MEMBERSHIP_STATE_LABEL, CADENCE_LABEL, ACCOUNT_STATE_LABEL } from "../shared/enums.js";
import { zoneFor, cityFor } from "./zones.js";

type MemberSelf = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  state: string | null;
  timeZone: string | null;
  address: { line1: string; line2: string; city: string; postalCode: string } | null;
  gateNotes: string | null;
  accountState: string;
  erasesAt: string | null;
  membership: MembershipView;
};

export async function loadMember(): Promise<MemberSelf | null> {
  const result = await api<{ member: MemberSelf }>("/api/me");
  return result.ok ? result.data.member : null;
}

export function memberShell(member: MemberSelf, main: HTMLElement, bottomAction: HTMLElement | null, activeHref: string): HTMLElement {
  const nav = memberNav(member, activeHref);
  return el(
    "div",
    { class: "screen member-screen" },
    el("div", { class: "member-top" }, nav),
    announcementsRegion(),
    main,
    bottomAction ? el("div", { class: "bottom-bar" }, bottomAction) : el("div", { class: "bottom-bar", hidden: "" }),
  );
}

export async function memberHome(): Promise<HTMLElement> {
  const member = await loadMember();
  if (!member) return el("div");
  const firstName = member.name.split(" ")[0] ?? "";
  const main = el("main", { class: "page member-home" });
  main.append(el("h1", { class: "page-title" }, `Welcome, ${firstName}`));
  const cards = el("div", { class: "member-cards" });
  const membershipCard = el("section", { class: "card" });
  membershipCard.append(el("h2", { class: "card-title" }, "Membership"));
  membershipCard.append(el("p", { class: "card-value", "data-part": "membership-state" }, membershipLine(member.membership)));
  cards.append(membershipCard);
  const drawsCard = el("section", { class: "card" });
  drawsCard.append(el("h2", { class: "card-title" }, "Draws"));
  drawsCard.append(el("p", { class: "card-copy" }, "Book or move an at-home fasting draw in your own local time."));
  cards.append(drawsCard);
  const resultsCard = el("section", { class: "card" });
  resultsCard.append(el("h2", { class: "card-title" }, "Results"));
  resultsCard.append(el("p", { class: "card-copy" }, "Read every released draw on the marker band."));
  cards.append(resultsCard);
  main.append(cards);
  const book = el("a", { href: "/me/draws", class: "button primary" }, "Book a draw");
  return memberShell(member, main, book, "/me");
}

export function membershipLine(membership: MembershipView): string {
  const label = MEMBERSHIP_STATE_LABEL[membership.state];
  if (membership.state === "free") return label;
  if (membership.state === "pending") return `${label} · ${CADENCE_LABEL[membership.cadence ?? "sixMonths"]} from ${formatDate(membership.pendingFrom ?? membership.renewalDate ?? "")}`;
  if (membership.state === "active") return `${label} · Renews ${formatDate(membership.renewalDate ?? "")}`;
  return `${label} · Plus until ${formatDate(membership.plusUntil ?? "")}`;
}

export async function membershipPage(): Promise<HTMLElement> {
  const member = await loadMember();
  if (!member) return el("div");
  const main = el("main", { class: "page member-membership" });
  main.append(el("h1", { class: "page-title" }, "Membership"));
  const card = el("section", { class: "card" });
  const state = el("p", { class: "card-value", "data-part": "membership-state" }, membershipLine(member.membership));
  card.append(state);
  main.append(card);

  let bottom: HTMLElement;
  if (member.membership.state === "free") {
    const join = el("button", { type: "button", class: "button primary" }, "Join Plus");
    join.addEventListener("click", () => {
      openJoinDialog(join, member);
    });
    bottom = join;
    const joinInline = el("button", { type: "button", class: "button primary", onclick: () => openJoinDialog(join, member) }, "Join Plus");
    card.append(joinInline);
  } else {
    const change = el("button", { type: "button", class: "button primary" }, "Change cadence");
    change.addEventListener("click", () => {
      openChangeDialog(change, member);
    });
    bottom = change;
    const changeInline = el("button", { type: "button", class: "button", onclick: () => openChangeDialog(change, member) }, "Change cadence");
    card.append(changeInline);
    const cancel = el("button", { type: "button", class: "button ghost" }, "Cancel Plus");
    cancel.addEventListener("click", () => {
      openCancelDialog(cancel, member);
    });
    card.append(cancel);
  }
  return memberShell(member, main, bottom, "/me/membership");
}

function openJoinDialog(opener: HTMLElement, member: MemberSelf): void {
  clearProblems();
  let cadence: "sixMonths" | "yearly" = "sixMonths";
  openDialog(
    {
      title: "Join Plus",
      content: (dialog) => {
        const form = el("form", { class: "form", novalidate: true });
        const six = el("input", { type: "radio", name: "join-cadence", id: "join-six", value: "sixMonths", checked: true });
        const yearly = el("input", { type: "radio", name: "join-cadence", id: "join-year", value: "yearly" });
        six.addEventListener("change", () => (cadence = "sixMonths"));
        yearly.addEventListener("change", () => (cadence = "yearly"));
        const group = el("div", { class: "radio-row", role: "radiogroup", "aria-label": "Billing cadence" });
        group.append(
          el("label", { class: "radio-option", for: "join-six" }, six, el("span", {}, "Every 6 months")),
          el("label", { class: "radio-option", for: "join-year" }, yearly, el("span", {}, "Yearly"))
        );
        const confirm = el("button", { type: "submit", class: "button primary" }, "Confirm and join");
        form.append(group, confirm);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          confirm.setAttribute("disabled", "");
          const key = `join-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const response = await api<{ membership: MembershipView }>("/api/me/membership", {
            method: "POST",
            headers: { "Request-Key": key },
            body: JSON.stringify({ cadence }),
          });
          confirm.removeAttribute("disabled");
          if (response.ok) {
            dialog.close();
            dialog.remove();
            const line = response.data.membership.state === "active" ? "Welcome to Plus. Your membership is active." : "Your payment is being confirmed. Plus shows Active once it is.";
            announce(line);
            navigate("/me/membership");
            void member;
            return;
          }
          const message = el("p", { class: "dialog-message", tabindex: "-1" }, response.message);
          const body = dialog.querySelector(".dialog-body");
          const existing = body?.querySelector(".dialog-message");
          if (existing) existing.remove();
          body?.prepend(message);
          message.focus();
        });
        return form;
      },
    },
    opener
  );
}

function openChangeDialog(opener: HTMLElement, member: MemberSelf): void {
  clearProblems();
  openDialog(
    {
      title: "Change cadence",
      content: (dialog) => {
        const form = el("form", { class: "form", novalidate: true });
        const six = el("input", { type: "radio", name: "change-cadence", id: "change-six", value: "sixMonths" });
        const yearly = el("input", { type: "radio", name: "change-cadence", id: "change-year", value: "yearly" });
        const group = el("div", { class: "radio-row", role: "radiogroup", "aria-label": "Billing cadence" });
        group.append(
          el("label", { class: "radio-option", for: "change-six" }, six, el("span", {}, "Every 6 months")),
          el("label", { class: "radio-option", for: "change-year" }, yearly, el("span", {}, "Yearly"))
        );
        const confirm = el("button", { type: "submit", class: "button primary" }, "Confirm change");
        form.append(group, confirm);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const next = document.querySelector<HTMLInputElement>("input[name='change-cadence']:checked")?.value;
          confirm.setAttribute("disabled", "");
          const response = await api<{ membership: MembershipView }>("/api/me/membership", {
            method: "PATCH",
            body: JSON.stringify({ cadence: next }),
          });
          confirm.removeAttribute("disabled");
          if (response.ok) {
            dialog.close();
            dialog.remove();
            announce("Your cadence changes at your next renewal.");
            navigate("/me/membership");
            void member;
            return;
          }
          const message = el("p", { class: "dialog-message", tabindex: "-1" }, response.message);
          const body = dialog.querySelector(".dialog-body");
          const existing = body?.querySelector(".dialog-message");
          if (existing) existing.remove();
          body?.prepend(message);
          message.focus();
        });
        return form;
      },
    },
    opener
  );
}

function openCancelDialog(opener: HTMLElement, member: MemberSelf): void {
  openDialog(
    {
      title: "Cancel Plus",
      content: (dialog) => {
        const copy = el("p", { class: "dialog-copy" }, "Plus stays until the end of your paid period.");
        const yes = el("button", { type: "button", class: "button primary" }, "Yes, cancel Plus");
        yes.addEventListener("click", async () => {
          yes.setAttribute("disabled", "");
          const response = await api<{ membership: MembershipView }>("/api/me/membership/cancel", {
            method: "POST",
            body: JSON.stringify({}),
          });
          yes.removeAttribute("disabled");
          if (response.ok) {
            dialog.close();
            dialog.remove();
            announce("Plus stays until the end of your paid period.");
            navigate("/me/membership");
            return;
          }
          const message = el("p", { class: "dialog-message", tabindex: "-1" }, response.message);
          const body = dialog.querySelector(".dialog-body");
          body?.prepend(message);
          message.focus();
        });
        const keep = el("button", { type: "button", class: "button ghost" }, "Keep Plus");
        keep.addEventListener("click", () => {
          dialog.close();
          dialog.remove();
        });
        return el("div", { class: "dialog-actions" }, copy, el("div", { class: "button-row" }, yes, keep));
      },
    },
    opener
  );
}

type DrawView = {
  id: string;
  phlebotomistName: string;
  state: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  timeZone: string;
  changesCloseAt: string | null;
  visitPage: { state: string; endsAt: string | null };
};

export async function memberDrawsPage(): Promise<HTMLElement> {
  const member = await loadMember();
  if (!member) return el("div");
  const result = await api<{ draws: DrawView[] }>("/api/me/draws");
  const draws = result.ok ? result.data.draws : [];
  const main = el("main", { class: "page member-draws" });
  main.append(el("h1", { class: "page-title" }, "Your draws"));
  const list = el("div", { class: "card-list" });
  for (const draw of draws) {
    const card = el("section", { class: "card draw-card" });
    const zone = zoneFor(draw.timeZone);
    const city = cityFor(draw.timeZone);
    card.append(el("h2", { class: "card-title" }, `Draw on ${formatDate(draw.localDate, zone)}`));
    card.append(el("p", { class: "card-copy" }, `${draw.localTime} ${city} time · ${draw.phlebotomistName}`));
    card.append(el("p", { class: "card-copy" }, draw.state));
    const open = el("a", { href: `/me/draws/${draw.id}`, class: "text-link" }, "Open draw");
    card.append(open);
    list.append(card);
  }
  main.append(list);
  const book = el("a", { href: "/me/draws", class: "button primary" }, "Book a draw");
  return memberShell(member, main, book, "/me/draws");
}

export async function memberDrawDetail(drawId: string): Promise<HTMLElement> {
  const member = await loadMember();
  if (!member) return el("div");
  const result = await api<{ draw: DrawView }>(`/api/me/draws/${drawId}`);
  if (!result.ok) return el("div");
  const draw = result.data.draw;
  const zone = zoneFor(draw.timeZone);
  const city = cityFor(draw.timeZone);
  const main = el("main", { class: "page member-draw narrow" });
  main.append(el("h1", { class: "page-title" }, `Draw on ${formatDate(draw.localDate, zone)}`));
  const card = el("section", { class: "card" });
  card.append(el("p", { class: "card-copy" }, `Draw booked for ${formatDate(draw.localDate, zone)}, ${draw.localTime} ${city} time.`));
  card.append(el("p", { class: "card-copy" }, `With ${draw.phlebotomistName} · ${draw.state}`));
  main.append(card);
  const move = el("button", { type: "button", class: "button primary" }, "Move draw");
  return memberShell(member, main, move, "/me/draws");
}

export async function memberPlanPage(): Promise<HTMLElement> {
  const member = await loadMember();
  if (!member) return el("div");
  const result = await api<{ plan: { publishedAt: string; publishedBy: string; sections: Record<string, string> } | null }>("/api/me/plan");
  const main = el("main", { class: "page member-plan narrow" });
  main.append(el("h1", { class: "page-title" }, "Your longevity plan"));
  if (result.ok && result.data.plan) {
    const plan = result.data.plan;
    const byline = el("p", { class: "byline" }, `Published ${formatDate(plan.publishedAt.slice(0, 10))} by ${plan.publishedBy}`);
    main.append(byline);
    for (const [key, text] of Object.entries(plan.sections)) {
      const section = el("section", { class: "card" });
      const title = key === "supplements" ? "Supplements" : key.charAt(0).toUpperCase() + key.slice(1);
      section.append(el("h2", { class: "card-title" }, title));
      for (const paragraph of text.split("\n\n")) {
        if (paragraph.startsWith("- ")) {
          const list = el("ul", { class: "plan-list" });
          for (const line of paragraph.split("\n")) {
            list.append(el("li", {}, line.replace(/^- /, "")));
          }
          section.append(list);
        } else {
          section.append(el("p", { class: "card-copy" }, paragraph));
        }
      }
      main.append(section);
    }
  } else {
    main.append(el("p", { class: "card-copy" }, "Your specialist has not published a plan yet."));
  }
  const message = el("a", { href: "/me/messages", class: "button primary" }, "Message your care team");
  return memberShell(member, main, message, "/me/plan");
}

export async function memberMessagesPage(): Promise<HTMLElement> {
  const member = await loadMember();
  if (!member) return el("div");
  const result = await api<{ messages: { id: string; from: { role: string; name: string }; body: string; sentAt: string }[] }>("/api/me/messages");
  const messages = result.ok ? result.data.messages : [];
  const main = el("main", { class: "page member-messages narrow" });
  main.append(el("h1", { class: "page-title" }, "Messages"));
  const log = el("div", { class: "message-log", role: "log", "aria-label": "Messages" });
  for (const message of messages) {
    const node = el("article", { class: `message message-${message.from.role}` });
    node.append(el("p", { class: "message-meta" }, `${message.from.name} · ${formatInstant(message.sentAt, zoneFor(member.timeZone ?? "phoenix"))}`));
    node.append(el("p", { class: "message-body" }, message.body));
    log.append(node);
  }
  main.append(log);
  const form = el("form", { class: "form message-form", novalidate: true });
  const box = el("textarea", { id: "message", class: "input", "aria-label": "Message", rows: "4" });
  const counter = el("p", { class: "char-counter" }, "0 of 2,000 characters");
  box.addEventListener("input", () => {
    counter.textContent = `${[...(box as HTMLTextAreaElement).value].length} of 2,000 characters`;
  });
  const file = el("input", { type: "file", id: "attachment", class: "input", "aria-label": "Attachment" });
  const send = el("button", { type: "submit", class: "button primary" }, "Send message");
  form.append(box, counter, file, send);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    send.setAttribute("disabled", "");
    const data = new FormData();
    data.set("body", (box as HTMLTextAreaElement).value);
    const files = (file as HTMLInputElement).files;
    if (files && files.length > 0) {
      data.set("attachment", files[0] ?? "");
    }
    const response = await fetch("/api/me/messages", { method: "POST", body: data, credentials: "same-origin" });
    send.removeAttribute("disabled");
    if (response.ok) {
      announce("Message sent.");
      (box as HTMLTextAreaElement).value = "";
      counter.textContent = "0 of 2,000 characters";
      const refreshed = await api<{ messages: { id: string; from: { role: string; name: string }; body: string; sentAt: string }[] }>("/api/me/messages");
      if (refreshed.ok) {
        log.replaceChildren();
        for (const message of refreshed.data.messages) {
          const node = el("article", { class: `message message-${message.from.role}` });
          node.append(el("p", { class: "message-meta" }, `${message.from.name}`));
          node.append(el("p", { class: "message-body" }, message.body));
          log.append(node);
        }
      }
      return;
    }
    const body = await response.json().catch(() => null);
    const text = body?.error?.message ?? "Something went wrong.";
    announce(text);
    problemsRegion(body?.error?.fields ?? {}, false);
  });
  main.append(form);
  const bottom = el("button", { type: "button", class: "button primary", onclick: () => form.requestSubmit() }, "Send message");
  return memberShell(member, main, bottom, "/me/messages");
}

export async function memberRecordsPage(): Promise<HTMLElement> {
  const member = await loadMember();
  if (!member) return el("div");
  const receiptsResult = await api<{ receipts: { id: string; number: string; amountCents: number; paidDate: string }[] }>("/api/me/receipts");
  const receipts = receiptsResult.ok ? receiptsResult.data.receipts : [];
  const main = el("main", { class: "page member-records narrow" });
  main.append(el("h1", { class: "page-title" }, "Records and receipts"));
  const download = el("button", { type: "button", class: "button" }, "Download results history");
  download.addEventListener("click", async () => {
    const response = await fetch("/api/me/results-history", { credentials: "same-origin" });
    if (response.ok) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = el("a", { href: url, download: "ocotillo-results-history.csv" });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      announce("Your results history is downloading.");
    } else {
      const body = await response.json().catch(() => null);
      announce(body?.error?.message ?? "Something went wrong.");
    }
  });
  main.append(download);
  const table = el("table", { class: "data-table" });
  table.append(el("caption", {}, "Receipts"));
  const head = el("thead");
  const headRow = el("tr");
  headRow.append(el("th", { scope: "col" }, "Receipt"), el("th", { scope: "col" }, "Paid"), el("th", { scope: "col" }, "Amount"));
  head.append(headRow);
  table.append(head);
  const body = el("tbody");
  for (const receipt of receipts) {
    const row = el("tr");
    const link = el("a", { href: `/receipts/${receipt.id}`, class: "text-link" }, receipt.number);
    row.append(el("td", {}, link), el("td", {}, formatDate(receipt.paidDate, "America/Phoenix")), el("td", {}, formatMoney(receipt.amountCents)));
    body.append(row);
  }
  table.append(body);
  const frame = el("div", { class: "table-frame", role: "region", "aria-label": "Receipts table", tabindex: "0" }, table);
  main.append(frame);
  const bottom = el("button", { type: "button", class: "button primary", onclick: () => download.click() }, "Download results history");
  return memberShell(member, main, bottom, "/me/records");
}

export async function memberResultsPage(): Promise<HTMLElement> {
  const member = await loadMember();
  if (!member) return el("div");
  const { markerBandPage } = await import("./pages-results.js");
  return markerBandPage(member);
}

export async function memberAccountPage(): Promise<HTMLElement> {
  const member = await loadMember();
  if (!member) return el("div");
  const main = el("main", { class: "page member-account narrow" });
  main.append(el("h1", { class: "page-title" }, "Your account"));
  const state = el("p", { class: "card-copy" }, ACCOUNT_STATE_LABEL[member.accountState as keyof typeof ACCOUNT_STATE_LABEL] ?? member.accountState);
  if (member.accountState === "closing" && member.erasesAt) {
    const zone = zoneFor(member.timeZone ?? "phoenix");
    state.textContent = `Your account is closing. It will be erased at ${formatInstant(member.erasesAt, zone)} unless the practice brings it back.`;
  }
  main.append(state);
  const form = el("form", { class: "form", novalidate: true });
  const phone = el("input", { type: "tel", id: "phone", class: "input", "aria-label": "Phone", value: member.phone ?? "" });
  const line1 = el("input", { type: "text", id: "line1", class: "input", "aria-label": "Address line 1", value: member.address?.line1 ?? "" });
  const line2 = el("input", { type: "text", id: "line2", class: "input", "aria-label": "Address line 2", value: member.address?.line2 ?? "" });
  const city = el("input", { type: "text", id: "city", class: "input", "aria-label": "City", value: member.address?.city ?? "" });
  const zip = el("input", { type: "text", id: "postalCode", class: "input", "aria-label": "ZIP code", value: member.address?.postalCode ?? "" });
  const gateNotes = el("input", { type: "text", id: "gateNotes", class: "input", "aria-label": "Gate notes", value: member.gateNotes ?? "" });
  const save = el("button", { type: "submit", class: "button primary" }, "Save profile");
  form.append(
    el("label", { class: "field-label", for: "phone" }, "Phone"), phone,
    el("label", { class: "field-label", for: "line1" }, "Address line 1"), line1,
    el("label", { class: "field-label", for: "line2" }, "Address line 2"), line2,
    el("label", { class: "field-label", for: "city" }, "City"), city,
    el("label", { class: "field-label", for: "postalCode" }, "ZIP code"), zip,
    el("label", { class: "field-label", for: "gateNotes" }, "Gate notes"), gateNotes,
    save
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.setAttribute("disabled", "");
    const response = await api("/api/me", {
      method: "PATCH",
      body: JSON.stringify({
        phone: (phone as HTMLInputElement).value,
        address: {
          line1: (line1 as HTMLInputElement).value,
          line2: (line2 as HTMLInputElement).value,
          city: (city as HTMLInputElement).value,
          postalCode: (zip as HTMLInputElement).value,
        },
        gateNotes: (gateNotes as HTMLInputElement).value,
      }),
    });
    save.removeAttribute("disabled");
    if (response.ok) {
      announce("Profile saved.");
      clearProblems();
      return;
    }
    announce(response.message || "Something went wrong.");
    problemsRegion(response.fields ?? {}, true);
  });
  main.append(form);

  const changePassword = el("button", { type: "button", class: "button" }, "Change password");
  changePassword.addEventListener("click", () => {
    openDialog(
      {
        title: "Change password",
        content: (dialog) => {
          const form2 = el("form", { class: "form", novalidate: true });
          const current = el("input", { type: "password", id: "currentPassword", class: "input", "aria-label": "Current password" });
          const next = el("input", { type: "password", id: "newPassword", class: "input", "aria-label": "New password" });
          const saveButton = el("button", { type: "submit", class: "button primary" }, "Save password");
          form2.append(
            el("label", { class: "field-label", for: "currentPassword" }, "Current password"), current,
            el("label", { class: "field-label", for: "newPassword" }, "New password"), next,
            saveButton
          );
          form2.addEventListener("submit", async (event) => {
            event.preventDefault();
            saveButton.setAttribute("disabled", "");
            const response = await api("/api/me/password", {
              method: "POST",
              body: JSON.stringify({
                currentPassword: (current as HTMLInputElement).value,
                newPassword: (next as HTMLInputElement).value,
              }),
            });
            saveButton.removeAttribute("disabled");
            if (response.ok) {
              dialog.close();
              dialog.remove();
              announce("Password changed. Your other sessions have ended.");
              return;
            }
            const message = el("p", { class: "dialog-message", tabindex: "-1" }, response.message);
            const body = dialog.querySelector(".dialog-body");
            body?.prepend(message);
            message.focus();
          });
          return form2;
        },
      },
      changePassword
    );
  });
  main.append(changePassword);

  if (member.accountState === "active") {
    const close = el("button", { type: "button", class: "button ghost" }, "Close account");
    close.addEventListener("click", () => {
      openDialog(
        {
          title: "Close account",
          content: (dialog) => {
            const copy = el("p", { class: "dialog-copy" }, "Your account closes and, after a wait, everything personal is erased. Your Plus runs to the end of the paid period.");
            const yes = el("button", { type: "button", class: "button primary" }, "Yes, close my account");
            yes.addEventListener("click", async () => {
              yes.setAttribute("disabled", "");
              const response = await api<{ member: MemberSelf }>("/api/me/closure", {
                method: "POST",
                body: JSON.stringify({}),
              });
              yes.removeAttribute("disabled");
              if (response.ok) {
                dialog.close();
                dialog.remove();
                announce("Your account is closing.");
                navigate("/me/account");
                return;
              }
              const message = el("p", { class: "dialog-message", tabindex: "-1" }, response.message);
              const body = dialog.querySelector(".dialog-body");
              body?.prepend(message);
              message.focus();
            });
            const keep = el("button", { type: "button", class: "button ghost" }, "Keep my account");
            keep.addEventListener("click", () => {
              dialog.close();
              dialog.remove();
            });
            return el("div", { class: "dialog-actions" }, copy, el("div", { class: "button-row" }, yes, keep));
          },
        },
        close
      );
    });
    main.append(close);
  }

  const bottom = el("button", { type: "button", class: "button primary", onclick: () => form.requestSubmit() }, "Save profile");
  return memberShell(member, main, bottom, "/me/account");
}

