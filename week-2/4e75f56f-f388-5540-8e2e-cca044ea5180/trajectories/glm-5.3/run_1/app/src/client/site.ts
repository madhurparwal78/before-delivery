import { el, clear, announce } from "./ui.js";
import { state } from "./state.js";
import { buildLab, type LabHandle } from "./lab.js";
import { openDialog, field } from "./ui.js";
import { api, ApiFailure } from "./api.js";
import { refreshMe } from "./state.js";

/**
 * The public site: seven chapters from overture to reserve, plus the chapter
 * navigation rail and the reserve bar.
 */

export const CHAPTERS = [
  { id: "chapter-overture", no: "01", name: "Overture" },
  { id: "chapter-method", no: "02", name: "Method" },
  { id: "chapter-days", no: "03", name: "Two days" },
  { id: "chapter-lab", no: "04", name: "The lab" },
  { id: "chapter-evenings", no: "05", name: "Evenings" },
  { id: "chapter-venue", no: "06", name: "Venue" },
  { id: "chapter-reserve", no: "07", name: "Reserve" },
] as const;

export interface SiteHandle {
  root: HTMLElement;
  lab: LabHandle;
  updateRail(): void;
  updateReserveBar(): void;
  refreshContent(): void;
}

export function buildSite(dockedBar: HTMLElement): SiteHandle {
  const root = el("div", {});
  const dockedBarPlaceholder = dockedBar;

  // 01 Overture
  const overture = el("section", { class: "chapter", id: "chapter-overture" });
  overture.append(
    el(
      "div",
      { class: "chapter-head" },
      el("p", { class: "eyebrow" }, "Opaline Institute presents"),
      el("h1", { class: "chapter-title", id: "chapter-overture-heading", tabindex: "-1" },
        el("span", { class: "line" }, "Layered Composite"),
        el("span", { class: "line" }, "Masterclass")
      )
    ),
    el(
      "div",
      { class: "chapter-body" },
      el("p", { class: "lede" }, "Two days at the bench, layering light into direct composite — Friday 16 and Saturday 17 April 2027, Chicago."),
      el("p", {}, "24 benches. 16 CE credits. One cure at a time."),
      el("p", { class: "num" }, "$3,450 Bench · $5,900 Atelier")
    )
  );

  // 02 Method
  const method = el("section", { class: "chapter", id: "chapter-method" });
  method.append(
    el("div", { class: "chapter-head" },
      el("p", { class: "chapter-no" }, "02"),
      el("h2", { class: "chapter-title", id: "chapter-method-heading", tabindex: "-1" },
        el("span", { class: "line" }, "Method")
      )
    ),
    el("div", { class: "chapter-body" },
      el("p", { class: "lede" }, "Shade, layer, light: a complete method for anterior and posterior direct composite."),
      el("p", {}, "You will read chroma, value and translucency zones on natural incisors, build palatal shells from silicone indices, layer Class IV restorations on typodonts, and take Class II contacts to gloss."),
      el("p", {}, "Your instructor and course director is Dr. Celeste Marrow-Ibarra."),
      el("p", {}, "Opaline Institute is the provider (provider ID OI-PACE-219874). This course awards 16 CE credits in the format “Lecture and participation (hands-on)”.")
    )
  );

  // 03 Two days
  const days = el("section", { class: "chapter", id: "chapter-days" });
  const agendaWrap = el("div", { class: "chapter-body" });
  days.append(
    el("div", { class: "chapter-head" },
      el("p", { class: "chapter-no" }, "03"),
      el("h2", { class: "chapter-title", id: "chapter-days-heading", tabindex: "-1" }, "Two days")
    ),
    agendaWrap
  );

  // 04 The lab
  const lab = buildLab(dockedBarPlaceholder);

  // 05 Evenings
  const evenings = el("section", { class: "chapter", id: "chapter-evenings" });
  const eveningsBody = el("div", { class: "chapter-body" });
  evenings.append(
    el("div", { class: "chapter-head" },
      el("p", { class: "chapter-no" }, "05"),
      el("h2", { class: "chapter-title", id: "chapter-evenings-heading", tabindex: "-1" }, "Evenings")
    ),
    eveningsBody
  );

  // 06 Venue
  const venue = el("section", { class: "chapter", id: "chapter-venue" });
  const venueBody = el("div", { class: "chapter-body" });
  venue.append(
    el("div", { class: "chapter-head" },
      el("p", { class: "chapter-no" }, "06"),
      el("h2", { class: "chapter-title", id: "chapter-venue-heading", tabindex: "-1" }, "Venue")
    ),
    venueBody
  );

  // 07 Reserve
  const reserve = el("section", { class: "chapter", id: "chapter-reserve" });
  const reserveBody = el("div", { class: "chapter-body" });
  reserve.append(
    el("div", { class: "chapter-head" },
      el("p", { class: "chapter-no" }, "07"),
      el("h2", { class: "chapter-title", id: "chapter-reserve-heading", tabindex: "-1" }, "Reserve")
    ),
    reserveBody
  );

  root.append(overture, method, days, lab.root, evenings, venue, reserve);

  // ---------- Agenda rendering ----------
  let agendaDay = 1;

  function renderAgenda(): void {
    clear(agendaWrap);
    const content = state.content;
    const tabs = el("div", { class: "agenda-tabs", role: "tablist", "aria-label": "Agenda days" });
    const tab1 = el("button", { class: "tab", role: "tab", id: "tab-day-1", "aria-selected": String(agendaDay === 1), "aria-controls": "panel-day-1" }, "Day 1");
    const tab2 = el("button", { class: "tab", role: "tab", id: "tab-day-2", "aria-selected": String(agendaDay === 2), "aria-controls": "panel-day-2" }, "Day 2");
    tab1.tabIndex = agendaDay === 1 ? 0 : -1;
    tab2.tabIndex = agendaDay === 2 ? 0 : -1;
    tabs.append(tab1, tab2);

    const moveDay = (day: number) => {
      agendaDay = day;
      renderAgenda();
    };
    tab1.addEventListener("click", () => moveDay(1));
    tab2.addEventListener("click", () => moveDay(2));
    tabs.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        moveDay(agendaDay === 1 ? 2 : 1);
      }
    });

    const panel = el("div", { role: "tabpanel", id: `panel-day-${agendaDay}`, "aria-labelledby": `tab-day-${agendaDay}` });
    if (!content) {
      panel.append(el("p", {}, state.contentDown ? "The programme is loading slowly. Refresh in a moment." : "The programme is loading slowly. Refresh in a moment."));
    } else {
      const list = el("ul", { class: "session-list" });
      for (const session of content.sessions.filter((s) => s.day === agendaDay)) {
        const item = el("li", { class: session.format === "hands-on" ? "session hands-on" : "session" });
        item.append(
          el("span", { class: "no num" }, String(session.number).padStart(2, "0")),
          el("div", {},
            el("div", { class: "meta" },
              el("span", { class: "format" }, session.format === "hands-on" ? "Hands-on" : "Lecture"),
              el("span", { class: "num" }, `${session.minutes} minutes`),
              el("span", { class: "num" }, `Day ${session.day}`)
            ),
            el("h3", {}, session.title),
            el("p", { class: "outcomes" }, session.outcomes)
          )
        );
        list.append(item);
      }
      panel.append(list);
    }
    agendaWrap.append(tabs, panel);
  }

  // ---------- Evenings rendering ----------
  function renderEvenings(): void {
    clear(eveningsBody);
    const content = state.content;
    if (!content) {
      eveningsBody.append(el("p", {}, "The programme is loading slowly. Refresh in a moment."));
      return;
    }
    const grid = el("div", { class: "evening-grid" });
    for (const evening of content.hospitality) {
      const card = el("article", { class: "evening-card" });
      const meta = el("p", { class: "meta" },
        el("span", { class: "num" }, `Day ${evening.day}`),
        evening.tier === "atelier"
          ? el("span", { class: "tier-label" }, el("span", { class: "lock", "aria-hidden": "true" }, "⌸"), "Atelier guests")
          : el("span", {}, "All guests")
      );
      card.append(el("h3", {}, evening.title), meta);
      const details = el("div", { hidden: "true" });
      const btn = el("button", { class: "disclose", "aria-expanded": "false", "aria-controls": details.id || undefined }, `Details for ${evening.title}`);
      btn.setAttribute("aria-label", `Details for ${evening.title}`);
      const body = evening.gated
        ? el("p", { class: "desc" }, "Reserved for Atelier guests. The time, venue and description open when you hold an Atelier seat.")
        : el("p", { class: "desc" }, `Starts ${evening.starts_at ?? ""} — ${evening.venue ?? ""}. ${evening.description ?? ""}`);
      details.append(body);
      const toggle = () => {
        const open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
        details.hidden = open;
      };
      btn.addEventListener("click", toggle);
      card.append(btn, details);
      grid.append(card);
    }
    eveningsBody.append(grid);
  }

  // ---------- Venue rendering ----------
  function renderVenue(): void {
    clear(venueBody);
    const content = state.content;
    const cols = el("div", { class: "venue-cols" });
    const address = el("div", {},
      el("h3", {}, "The Opaline Lab"),
      el("p", {}, "1460 West Kinzie Street"),
      el("p", {}, "Chicago, Illinois"),
      el("p", { class: "hint" }, "Row A faces the demo station. The doors open at 07:30 each morning.")
    );
    const hotelsWrap = el("div", {});
    hotelsWrap.append(el("h3", {}, "Hotels"));
    if (!content) {
      hotelsWrap.append(el("p", {}, "The programme is loading slowly. Refresh in a moment."));
    } else {
      const list = el("ul", { class: "hotel-list" });
      for (const hotel of content.hotels) {
        const link = el("a", { href: hotel.map_url, target: "_blank", rel: "noopener noreferrer" }, `Map for ${hotel.name}`);
        link.textContent = `Map for ${hotel.name}`;
        list.append(
          el("li", {},
            el("div", {},
              el("strong", {}, hotel.name),
              el("div", { class: "hint" }, `${hotel.distance} · ${hotel.rate}`)
            ),
            link
          )
        );
      }
      hotelsWrap.append(list);
    }
    cols.append(address, hotelsWrap);
    venueBody.append(cols);
  }

  // ---------- Reserve rendering ----------
  function renderReserve(): void {
    clear(reserveBody);
    const content = state.content;
    const grid = el("div", { class: "reserve-grid" });

    const left = el("div", {});
    left.append(el("h3", {}, "Prices and deadlines"));
    const table = el("table", { class: "price-table" });
    const tbody = el("tbody", {});
    tbody.append(
      priceRow("Bench tier", "$3,450.00", "Deposit $900.00 · Balance $2,550.00"),
      priceRow("Atelier tier", "$5,900.00", "Deposit $1,500.00 · Balance $4,400.00")
    );
    table.append(tbody);
    left.append(
      table,
      el("p", { class: "hint" }, "Deposits close on 19 March 2027. The balance is due the same day. From 20 March, seats are sold at full price only."),
      el("h3", { style: "margin-top:2rem" }, "Refunds"),
      el("p", { class: "hint" }, "Cancel by 15 January 2027 for a full refund less $250. From 16 January to 19 March 2027 you receive half of what you paid. After that, the seat may be reassigned but not refunded.")
    );
    const entry = el("div", { class: "auth-entry" });
    const signInBtn = el("button", { class: "btn btn-live" }, "Sign in");
    const createBtn = el("button", { class: "btn" }, "Create an account");
    const accountLink = el("a", { class: "btn btn-quiet", href: "/account" }, "My seats");
    if (state.me) {
      entry.append(accountLink);
      signInBtn.remove();
      createBtn.remove();
    } else {
      entry.append(signInBtn, createBtn);
    }
    signInBtn.addEventListener("click", () => openSignInDialog(signInBtn));
    createBtn.addEventListener("click", () => openSignInDialog(createBtn));
    left.append(entry);

    const right = el("div", {});
    right.append(el("h3", {}, "Questions"));
    if (!content) {
      right.append(el("p", {}, "The programme is loading slowly. Refresh in a moment."));
    } else {
      const list = el("ul", { class: "faq" });
      for (const entry2 of content.faq) {
        const li = el("li", {});
        const answer = el("div", { class: "a", hidden: "true" });
        const q = el("button", { class: "q", "aria-expanded": "false" }, entry2.question);
        q.addEventListener("click", () => {
          const open = q.getAttribute("aria-expanded") === "true";
          q.setAttribute("aria-expanded", String(!open));
          answer.hidden = open;
        });
        answer.append(el("p", {}, entry2.answer));
        li.append(q, answer);
        list.append(li);
      }
      right.append(list);
    }

    grid.append(left, right);
    reserveBody.append(grid);
  }

  function priceRow(tier: string, price: string, note: string): HTMLElement {
    const tr = el("tr", {});
    const first = el("td", { class: tier.includes("Atelier") ? "tier-atelier" : "" }, tier);
    tr.append(first, el("td", { class: "num" }, price), el("td", { class: "hint" }, note));
    return tr;
  }

  function openSignInDialog(opener: HTMLElement): void {
    openDialog({
      label: "Sign in",
      opener,
      build: (dialog) => {
        const form = el("form", {});
        const email = el("input", { type: "email" }) as HTMLInputElement;
        const password = el("input", { type: "password" }) as HTMLInputElement;
        const errorNote = el("p", { class: "field-error", hidden: "true" });
        const submit = el("button", { class: "btn btn-live", type: "submit" }, "Sign in");
        const createBtn = el("button", { class: "btn btn-quiet", type: "button" }, "Create an account");
        const closeBtn = el("button", { class: "btn btn-quiet", type: "button" }, "Close");
        form.append(el("h2", {}, "Sign in"), field("Email", email), field("Password", password), errorNote, submit, el("div", { class: "dialog-actions" }, createBtn, closeBtn));
        closeBtn.addEventListener("click", () => dialog.close());
        createBtn.addEventListener("click", () => {
          dialog.close();
          openCreateDialog(opener);
        });
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            await api("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: email.value, password: password.value }) });
            await refreshMe();
            renderReserve();
            dialog.close();
          } catch {
            errorNote.hidden = false;
            errorNote.textContent = "Email or password is incorrect.";
          }
        });
        return form;
      },
    });
  }

  function openCreateDialog(opener: HTMLElement): void {
    openDialog({
      label: "Create account",
      opener,
      build: (dialog) => {
        const form = el("form", {});
        const name = el("input", { type: "text" }) as HTMLInputElement;
        const email = el("input", { type: "email" }) as HTMLInputElement;
        const password = el("input", { type: "password" }) as HTMLInputElement;
        const errorNote = el("p", { class: "field-error", hidden: "true" });
        const submit = el("button", { class: "btn btn-live", type: "submit" }, "Create account");
        const closeBtn = el("button", { class: "btn btn-quiet", type: "button" }, "Close");
        form.append(el("h2", {}, "Create account"), field("Name", name), field("Email", email), field("Password", password), errorNote, submit, el("div", { class: "dialog-actions" }, closeBtn));
        closeBtn.addEventListener("click", () => dialog.close());
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            await api("/api/auth/signup", {
              method: "POST",
              body: JSON.stringify({ name: name.value, email: email.value, password: password.value, kind: "practitioner" }),
            });
            await refreshMe();
            renderReserve();
            dialog.close();
          } catch (e) {
            if (e instanceof ApiFailure) {
              errorNote.hidden = false;
              errorNote.textContent = e.body.message;
            }
          }
        });
        return form;
      },
    });
  }

  renderAgenda();
  renderEvenings();
  renderVenue();
  renderReserve();

  return {
    root,
    lab,
    updateRail() {},
    updateReserveBar() {},
    refreshContent() {
      renderAgenda();
      renderEvenings();
      renderVenue();
      renderReserve();
    },
  };
}
