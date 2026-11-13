import { DateTime } from "luxon";
import { el, api } from "./dom.js";
import { announcementsRegion } from "./shell.js";
import { navigate } from "./router.js";
import { announce, formatDate, formatInstant, formatMoney } from "./motion.js";
import { STAFF_ZONE } from "./zones.js";

type StaffSelf = { id: string; name: string; role: string; home: string };

export async function loadStaff(): Promise<StaffSelf | null> {
  const result = await api<{ user: { id: string; name: string; role: string }; home: string }>("/api/session");
  if (!result.ok || result.data.user.role === "member") return null;
  return { ...result.data.user, home: result.data.home };
}

export function staffShell(staff: StaffSelf, main: HTMLElement, bottomAction: HTMLElement | null, activeHref: string): HTMLElement {
  const nav = el("nav", { class: "staff-nav", "aria-label": "Desk" });
  const links: Record<string, { label: string; href: string }[]> = {
    owner: [
      { label: "Members", href: "/staff/members" },
      { label: "Care messages", href: "/staff/messages" },
      { label: "Draw calendar", href: "/staff/calendar" },
      { label: "Results to release", href: "/staff/results" },
      { label: "Range table", href: "/staff/ranges" },
      { label: "Receipts", href: "/staff/receipts" },
      { label: "Team", href: "/staff/team" },
    ],
    specialist: [
      { label: "Members", href: "/staff/members" },
      { label: "Care messages", href: "/staff/messages" },
      { label: "Results to release", href: "/staff/results" },
    ],
    coordinator: [
      { label: "Members", href: "/staff/members" },
      { label: "Care messages", href: "/staff/messages" },
      { label: "Draw calendar", href: "/staff/calendar" },
    ],
    billingLead: [
      { label: "Members", href: "/staff/members" },
      { label: "Receipts", href: "/staff/receipts" },
    ],
  };
  for (const link of links[staff.role] ?? []) {
    nav.append(
      el(
        "a",
        {
          href: link.href,
          class: `staff-nav-link${link.href === activeHref ? " active" : ""}`,
          "aria-current": link.href === activeHref ? "page" : "",
        },
        link.label
      )
    );
  }
  const changePassword = el("button", { type: "button", class: "button ghost" }, "Change password");
  changePassword.addEventListener("click", () => {
    import("./dialogs.js").then(({ openDialog }) => {
      openDialog(
        {
          title: "Change password",
          content: (dialog) => {
            const form = el("form", { class: "form", novalidate: true });
            const current = el("input", { type: "password", id: "staff-current", class: "input", "aria-label": "Current password" });
            const next = el("input", { type: "password", id: "staff-new", class: "input", "aria-label": "New password" });
            const save = el("button", { type: "submit", class: "button primary" }, "Save password");
            form.append(
              el("label", { class: "field-label", for: "staff-current" }, "Current password"), current,
              el("label", { class: "field-label", for: "staff-new" }, "New password"), next,
              save
            );
            form.addEventListener("submit", async (event) => {
              event.preventDefault();
              save.setAttribute("disabled", "");
              const response = await api("/api/me/password", {
                method: "POST",
                body: JSON.stringify({
                  currentPassword: (current as HTMLInputElement).value,
                  newPassword: (next as HTMLInputElement).value,
                }),
              });
              save.removeAttribute("disabled");
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
            return form;
          },
        },
        changePassword
      );
    });
  });
  const signOut = el("button", { type: "button", class: "button ghost" }, "Sign out");
  signOut.addEventListener("click", async () => {
    await api("/api/session", { method: "DELETE" });
    navigate("/signin");
    window.location.reload();
  });
  nav.append(changePassword, signOut);
  return el(
    "div",
    { class: "screen staff-screen" },
    el("div", { class: "staff-top" }, nav),
    announcementsRegion(),
    main,
    bottomAction ? el("div", { class: "bottom-bar" }, bottomAction) : el("div", { class: "bottom-bar", hidden: "" }),
  );
}

export async function staffMembersPage(): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const result = await api<{ members: { id: string; name: string | null; email: string | null; accountState: string }[] }>("/api/members");
  const members = result.ok ? result.data.members : [];
  const main = el("main", { class: "page staff-members" });
  main.append(el("h1", { class: "page-title" }, "Members"));
  const table = el("table", { class: "data-table" });
  table.append(el("caption", { class: "sr-only" }, "Members"));
  const head = el("thead");
  const headRow = el("tr");
  for (const label of ["Member", "Email", "Account"]) {
    headRow.append(el("th", { scope: "col" }, label));
  }
  head.append(headRow);
  table.append(head);
  const body = el("tbody");
  for (const member of members) {
    const row = el("tr");
    const link = el("a", { href: `/staff/members/${member.id}`, class: "text-link" }, member.name ?? "Erased member");
    row.append(el("td", {}, link), el("td", {}, member.email ?? ""), el("td", {}, member.accountState));
    body.append(row);
  }
  table.append(body);
  main.append(el("div", { class: "table-frame", role: "region", "aria-label": "Members table", tabindex: "0" }, table));
  return staffShell(staff, main, null, "/staff/members");
}

export async function staffMemberPage(memberId: string): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const result = await api<{ member: { id: string; name: string | null; accountState: string } }>(`/api/members/${memberId}`);
  if (!result.ok) return el("div");
  const member = result.data.member;
  const main = el("main", { class: "page staff-member narrow" });
  main.append(el("h1", { class: "page-title" }, member.name ?? "Erased member"));
  const details = el("section", { class: "card" });
  details.append(el("p", { class: "card-copy" }, `Account ${member.accountState}`));
  main.append(details);
  const sections = el("div", { class: "card-list" });
  for (const [label, href] of [
    ["Results", `/staff/members/${memberId}/results`],
    ["Plan", `/staff/members/${memberId}/plan`],
    ["Blend", `/staff/members/${memberId}/blend`],
    ["Messages", `/staff/members/${memberId}/messages`],
  ] as const) {
    const card = el("section", { class: "card" });
    card.append(el("h2", { class: "card-title" }, label));
    card.append(el("a", { href, class: "text-link" }, `Open ${label.toLowerCase()}`));
    sections.append(card);
  }
  main.append(sections);
  return staffShell(staff, main, null, "/staff/members");
}

export async function staffMemberResultsPage(memberId: string): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const memberResult = await api<{ member: { name: string | null } }>(`/api/members/${memberId}`);
  const name = memberResult.ok ? (memberResult.data.member.name ?? "Erased member") : "Member";
  const main = el("main", { class: "page staff-results-page" });
  main.append(el("h1", { class: "page-title" }, `Results for ${name}`));
  const back = el("a", { href: `/staff/members/${memberId}`, class: "text-link" }, "Back to member");
  main.append(back);
  return staffShell(staff, main, null, `/staff/members/${memberId}`);
}

export async function staffMemberPlanPage(memberId: string): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const memberResult = await api<{ member: { name: string | null } }>(`/api/members/${memberId}`);
  const name = memberResult.ok ? (memberResult.data.member.name ?? "Erased member") : "Member";
  const main = el("main", { class: "page staff-plan-page narrow" });
  main.append(el("h1", { class: "page-title" }, `Plan for ${name}`));
  const edit = el("button", { type: "button", class: "button primary" }, "Edit plan");
  return staffShell(staff, main, edit, `/staff/members/${memberId}/plan`);
}

export async function staffPlanDetailPage(memberId: string, planId: string): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const memberResult = await api<{ member: { name: string | null } }>(`/api/members/${memberId}`);
  const name = memberResult.ok ? (memberResult.data.member.name ?? "Erased member") : "Member";
  const planResult = await api<{ plan: { publishedAt: string | null } }>(`/api/longevity-plans/${planId}`);
  const main = el("main", { class: "page staff-plan-page narrow" });
  const publishedAt = planResult.ok ? planResult.data.plan.publishedAt : null;
  main.append(el("h1", { class: "page-title" }, `Plan published ${publishedAt ? formatDate(publishedAt.slice(0, 10)) : "draft"}`));
  const back = el("a", { href: `/staff/members/${memberId}/plan`, class: "text-link" }, "Back to plan");
  main.append(back);
  return staffShell(staff, main, null, `/staff/members/${memberId}/plan`);
}

export async function staffMemberBlendPage(memberId: string): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const memberResult = await api<{ member: { name: string | null } }>(`/api/members/${memberId}`);
  const name = memberResult.ok ? (memberResult.data.member.name ?? "Erased member") : "Member";
  const main = el("main", { class: "page staff-blend-page" });
  main.append(el("h1", { class: "page-title" }, `Blend for ${name}`));
  const save = el("button", { type: "button", class: "button primary" }, "Save blend");
  return staffShell(staff, main, save, `/staff/members/${memberId}/blend`);
}

export async function staffBlendDetailPage(memberId: string, blendId: string): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const memberResult = await api<{ member: { name: string | null } }>(`/api/members/${memberId}`);
  const name = memberResult.ok ? (memberResult.data.member.name ?? "Erased member") : "Member";
  void blendId;
  const main = el("main", { class: "page staff-blend-page" });
  main.append(el("h1", { class: "page-title" }, `Blend for ${name}`));
  const save = el("button", { type: "button", class: "button primary" }, "Save blend");
  return staffShell(staff, main, save, `/staff/members/${memberId}/blend`);
}

export async function staffMemberMessagesPage(memberId: string): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const memberResult = await api<{ member: { name: string | null } }>(`/api/members/${memberId}`);
  const name = memberResult.ok ? (memberResult.data.member.name ?? "Erased member") : "Member";
  const main = el("main", { class: "page staff-messages-page narrow" });
  main.append(el("h1", { class: "page-title" }, `Messages with ${name}`));
  const reply = el("button", { type: "button", class: "button primary" }, "Send reply");
  return staffShell(staff, main, reply, `/staff/members/${memberId}/messages`);
}

export async function staffMessagesPage(): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const result = await api<{ threads: { memberId: string; memberName: string | null; state: string }[] }>("/api/message-threads");
  const threads = result.ok ? result.data.threads : [];
  const main = el("main", { class: "page staff-messages" });
  main.append(el("h1", { class: "page-title" }, "Care messages"));
  const list = el("div", { class: "card-list" });
  for (const thread of threads) {
    const card = el("section", { class: "card" });
    card.append(el("h2", { class: "card-title" }, thread.memberName ?? "Erased member"));
    card.append(el("p", { class: "card-copy" }, thread.state));
    card.append(el("a", { href: `/staff/members/${thread.memberId}/messages`, class: "text-link" }, "Open thread"));
    list.append(card);
  }
  main.append(list);
  const oldest = threads[0];
  const openOldest = el(
    "a",
    { href: oldest ? `/staff/members/${oldest.memberId}/messages` : "/staff/messages", class: "button primary" },
    "Open oldest open thread"
  );
  return staffShell(staff, main, openOldest, "/staff/messages");
}

export async function staffCalendarPage(): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const main = el("main", { class: "page staff-calendar" });
  main.append(el("h1", { class: "page-title" }, "Draw calendar"));
  const result = await api<{ draws: { id: string; memberName: string; localDate: string; localTime: string; timeZone: string; startsAt: string }[] }>("/api/draws?state=booked");
  const draws = result.ok ? result.data.draws : [];
  const wide = el("div", { class: "calendar-wide" });
  const table = el("table", { class: "data-table calendar-table" });
  table.append(el("caption", { class: "sr-only" }, "Draw calendar"));
  const head = el("thead");
  const headRow = el("tr");
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
    headRow.append(el("th", { scope: "col" }, day));
  }
  head.append(headRow);
  table.append(head);
  const body = el("tbody");
  const row = el("tr");
  for (let day = 0; day < 6; day++) {
    row.append(el("td", {}, ""));
  }
  body.append(row);
  table.append(body);
  wide.append(table);
  const dayView = el("div", { class: "calendar-day" });
  const prev = el("button", { type: "button", class: "button" }, "Previous day");
  const next = el("button", { type: "button", class: "button" }, "Next day");
  const dayList = el("div", { class: "card-list" });
  const dateLabel = el("p", { class: "card-copy" }, formatDate(new Date().toISOString().slice(0, 10), STAFF_ZONE));
  const renderDay = (isoDate: string) => {
    dayList.replaceChildren();
    dateLabel.textContent = formatDate(isoDate, STAFF_ZONE);
    for (const draw of draws.filter((d) => d.localDate === isoDate)) {
      const phoenixTime = formatInstant(draw.startsAt, STAFF_ZONE).split(", ")[1] ?? "";
      const link = el(
        "a",
        { href: `/staff/draws/${draw.id}`, class: "text-link" },
        `${formatDate(draw.localDate)}, ${phoenixTime} Phoenix time · ${draw.localTime} ${cityFor(draw.timeZone)} time`
      );
      dayList.append(el("p", {}, link));
    }
  };
  renderDay(new Date().toISOString().slice(0, 10));
  let cursorDate = new Date().toISOString().slice(0, 10);
  prev.addEventListener("click", () => {
    cursorDate = DateTime.fromISO(cursorDate).minus({ days: 1 }).toISODate() ?? cursorDate;
    renderDay(cursorDate);
  });
  next.addEventListener("click", () => {
    cursorDate = DateTime.fromISO(cursorDate).plus({ days: 1 }).toISODate() ?? cursorDate;
    renderDay(cursorDate);
  });
  dayView.append(el("div", { class: "button-row" }, prev, next), dateLabel, dayList);
  main.append(wide, dayView);
  const book = el("button", { type: "button", class: "button primary" }, "Book draw");
  return staffShell(staff, main, book, "/staff/calendar");
}

export async function staffDrawPage(drawId: string): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const result = await api<{ draw: { id: string; memberName: string; state: string; localDate: string; localTime: string; timeZone: string; startsAt: string; visitPage: { state: string; endsAt: string | null } } }>(`/api/draws/${drawId}`);
  if (!result.ok) return el("div");
  const draw = result.data.draw;
  const main = el("main", { class: "page staff-draw narrow" });
  main.append(el("h1", { class: "page-title" }, `Draw for ${draw.memberName} on ${formatDate(draw.localDate)}`));
  const card = el("section", { class: "card" });
  const phoenixTime = formatInstant(draw.startsAt, STAFF_ZONE).split(", ")[1] ?? "";
  card.append(el("p", { class: "card-copy" }, `${formatDate(draw.localDate)}, ${phoenixTime} Phoenix time · ${draw.localTime} ${cityFor(draw.timeZone)} time`));
  card.append(el("p", { class: "card-copy" }, draw.state));
  main.append(card);
  let action: HTMLElement | null = null;
  if (draw.state === "booked") {
    action = el("button", { type: "button", class: "button primary" }, "Send new visit page");
  } else if (draw.state === "collected") {
    action = el("button", { type: "button", class: "button primary" }, "Bring in results");
  } else if (draw.state === "ready") {
    action = el("button", { type: "button", class: "button primary" }, "Release results");
  }
  return staffShell(staff, main, action, "/staff/calendar");
}

export async function staffResultsQueuePage(): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const main = el("main", { class: "page staff-results-queue narrow" });
  main.append(el("h1", { class: "page-title" }, "Results to release"));
  const result = await api<{ draws: { id: string; memberName: string }[] }>("/api/draws?state=ready");
  const draws = result.ok ? result.data.draws : [];
  const list = el("div", { class: "card-list" });
  for (const draw of draws) {
    const card = el("section", { class: "card" });
    card.append(el("h2", { class: "card-title" }, draw.memberName));
    card.append(el("a", { href: `/staff/draws/${draw.id}`, class: "text-link" }, "Open draw"));
    list.append(card);
  }
  main.append(list);
  const next = draws[0];
  const openNext = el(
    "a",
    { href: next ? `/staff/draws/${next.id}` : "/staff/results", class: "button primary" },
    "Open next draw"
  );
  return staffShell(staff, main, openNext, "/staff/results");
}

export async function staffRangeTablePage(): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const main = el("main", { class: "page staff-ranges narrow" });
  main.append(el("h1", { class: "page-title" }, "Range table"));
  const change = el("button", { type: "button", class: "button primary" }, "Change ranges");
  return staffShell(staff, main, change, "/staff/ranges");
}

export async function staffReceiptsPage(): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const main = el("main", { class: "page staff-receipts" });
  main.append(el("h1", { class: "page-title" }, "Receipts"));
  const month = el("input", { type: "text", id: "month", class: "input", "aria-label": "Month", placeholder: "YYYY-MM" });
  const table = el("table", { class: "data-table" });
  table.append(el("caption", {}, "Receipts"));
  const head = el("thead");
  const headRow = el("tr");
  for (const label of ["Receipt", "Member", "Paid", "Amount"]) {
    headRow.append(el("th", { scope: "col" }, label));
  }
  head.append(headRow);
  table.append(head);
  const body = el("tbody");
  table.append(body);
  const frame = el("div", { class: "table-frame", role: "region", "aria-label": "Receipts table", tabindex: "0" }, table);
  const nextButton = el("button", { type: "button", class: "button" }, "Next page");
  let nextCursor: string | null = null;
  const loadMonth = async (cursor?: string) => {
    const value = (month as HTMLInputElement).value.trim();
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    const query = new URLSearchParams({ month: value });
    if (cursor) query.set("cursor", cursor);
    const result = await api<{ receipts: { id: string; number: string; memberName: string | null; paidDate: string; amountCents: number }[]; nextCursor: string | null }>(`/api/receipts?${query.toString()}`);
    if (!result.ok) return;
    body.replaceChildren();
    for (const receipt of result.data.receipts) {
      const row = el("tr");
      const link = el("a", { href: `/receipts/${receipt.id}`, class: "text-link" }, receipt.number);
      row.append(
        el("td", {}, link),
        el("td", {}, receipt.memberName ?? "Erased member"),
        el("td", {}, formatDate(receipt.paidDate, STAFF_ZONE)),
        el("td", {}, formatMoney(receipt.amountCents))
      );
      body.append(row);
    }
    nextCursor = result.data.nextCursor;
    nextButton.toggleAttribute("disabled", nextCursor === null);
  };
  month.addEventListener("input", () => {
    if (/^\d{4}-\d{2}$/.test((month as HTMLInputElement).value.trim())) {
      void loadMonth();
    }
  });
  month.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void loadMonth();
    }
  });
  nextButton.addEventListener("click", () => {
    if (nextCursor) void loadMonth(nextCursor);
  });
  main.append(month, frame, nextButton);
  return staffShell(staff, main, null, "/staff/receipts");
}

export async function staffTeamPage(): Promise<HTMLElement> {
  const staff = await loadStaff();
  if (!staff) return el("div");
  const main = el("main", { class: "page staff-team narrow" });
  main.append(el("h1", { class: "page-title" }, "Team"));
  const result = await api<{ staff: { id: string; name: string; email: string; role: string }[] }>("/api/staff");
  const people = result.ok ? result.data.staff : [];
  const list = el("div", { class: "card-list" });
  for (const person of people) {
    const card = el("section", { class: "card" });
    card.append(el("h2", { class: "card-title" }, person.name));
    card.append(el("p", { class: "card-copy" }, `${person.email} · ${person.role}`));
    list.append(card);
  }
  main.append(list);
  const add = el("button", { type: "button", class: "button primary" }, "Add staff member");
  return staffShell(staff, main, add, "/staff/team");
}

function cityFor(timeZone: string): string {
  const map: Record<string, string> = {
    newYork: "New York",
    chicago: "Chicago",
    denver: "Denver",
    phoenix: "Phoenix",
    losAngeles: "Los Angeles",
  };
  return map[timeZone] ?? "Phoenix";
}

