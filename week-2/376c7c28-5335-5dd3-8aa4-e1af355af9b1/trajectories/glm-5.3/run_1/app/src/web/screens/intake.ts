import { api, ApiCallError, type Ticket, type Passport } from "../api";
import { h, clear, liveRegion, announce, screen as appScreen, registerRefresh, screenDate } from "../helpers";
import { me } from "../main";

export function renderIntake(root: HTMLElement): void {
  const status = liveRegion("Intake status");
  const loggedList = h("ul", { class: "ticket-list", "aria-label": "Logged pieces" });
  const bisquedList = h("ul", { class: "ticket-list", "aria-label": "Bisqued pieces" });
  const readyList = h("ul", { class: "ticket-list", "aria-label": "Ready for pickup" });
  const loggedCol = h("section", { class: "panel intake-col" }, h("div", { class: "caption", text: "LOGGED" }), loggedList);
  const bisquedCol = h("section", { class: "panel intake-col" }, h("div", { class: "caption", text: "BISQUED" }), bisquedList);
  const readyCol = h("section", { class: "panel intake-col" }, h("div", { class: "caption", text: "READY FOR PICKUP" }), readyList);
  const grid = h("div", { class: "intake-grid" }, loggedCol, bisquedCol, readyCol);
  root.appendChild(appScreen(grid, status));
  const isOwner = me()?.person.role === "owner";
  void load();

  async function load(): Promise<void> {
    try {
      const [logged, bisqued, ready] = await Promise.all([
        api<Ticket[]>("/api/pieces?status=logged"),
        api<Ticket[]>("/api/pieces?status=bisqued"),
        api<Ticket[]>("/api/pieces?status=ready_for_pickup"),
      ]);
      fillList(loggedList, logged, (t) => [h("button", { class: "btn small", text: `Check in ${t.title}`, onclick: () => void checkIn(t) })]);
      fillList(bisquedList, bisqued, (t) => [h("button", { class: "btn small", text: `Check in for glaze ${t.title}`, onclick: () => void checkIn(t) })]);
      fillList(readyList, ready, (t) => {
        const buttons = [h("button", { class: "btn small", text: `Mark collected ${t.title}`, onclick: () => void collect(t) })];
        if (isOwner) {
          buttons.push(h("button", { class: "btn small", text: `Mark uncollected ${t.title}`, onclick: () => void markUncollected(t) }));
        }
        return buttons;
      });
    } catch {
      /* the next live update will refill the lists */
    }
  }

  function fillList(list: HTMLElement, tickets: Ticket[], actions: (t: Ticket) => HTMLElement[]): void {
    clear(list);
    if (tickets.length === 0) {
      list.appendChild(h("li", { class: "ticket empty", text: "None" }));
      return;
    }
    for (const ticket of tickets) {
      list.appendChild(
        h("li", { class: "ticket" },
          thumb(ticket),
          h("div", { class: "ticket-meta" },
            h("div", { class: "ticket-title", text: ticket.title }),
            h("div", { class: "muted", text: `${ticket.owner_handle} · ${ticket.clay_body} · ${ticket.length_in} × ${ticket.width_in} × ${ticket.height_in} IN` })),
          ...actions(ticket),
        ),
      );
    }
  }

  function thumb(ticket: Ticket): HTMLElement {
    const wrap = h("div", { class: "thumb" });
    const none = (): HTMLElement => h("div", { class: "thumb-none", text: "—" });
    if (ticket.photo_url) {
      const img = document.createElement("img");
      img.alt = "";
      img.className = "thumb-img";
      void (async () => {
        try {
          const blob = await api<ArrayBuffer>(ticket.photo_url as string);
          img.src = URL.createObjectURL(new Blob([blob]));
          wrap.appendChild(img);
        } catch {
          wrap.appendChild(none());
        }
      })();
    } else {
      wrap.appendChild(none());
    }
    return wrap;
  }

  async function checkIn(ticket: Ticket): Promise<void> {
    announce(status, "Checking in…");
    try {
      await api(`/api/pieces/${encodeURIComponent(ticket.id)}/check-in`, { method: "POST", body: {} });
      announce(status, `${ticket.title} is on the waiting for bisque rack.`);
    } catch (err) {
      announce(status, await refusalMessage(err, ticket, "check-in"));
    }
    await load();
  }

  async function collect(ticket: Ticket): Promise<void> {
    announce(status, "Saving…");
    try {
      await api(`/api/pieces/${encodeURIComponent(ticket.id)}/collect`, { method: "POST", body: {} });
      announce(status, `${ticket.title} collected.`);
    } catch (err) {
      announce(status, await refusalMessage(err, ticket, "collect"));
    }
    await load();
  }

  async function markUncollected(ticket: Ticket): Promise<void> {
    announce(status, "Saving…");
    try {
      await api(`/api/pieces/${encodeURIComponent(ticket.id)}/mark-uncollected`, { method: "POST", body: {} });
      announce(status, `${ticket.title} marked uncollected.`);
    } catch (err) {
      announce(status, await refusalMessage(err, ticket, "mark-uncollected"));
    }
    await load();
  }

  async function refusalMessage(err: unknown, ticket: Ticket, action: "check-in" | "collect" | "mark-uncollected"): Promise<string> {
    if (err instanceof ApiCallError && err.kind === "api") {
      const code = err.body.error;
      if (code === "photo_required") return `${ticket.title} needs an intake photo before check-in.`;
      if (code === "member_inactive") return `${ticket.title} belongs to an inactive member.`;
      if (code === "illegal_transition") {
        if (action === "check-in") return `${ticket.title} can't be checked in now.`;
        if (action === "collect") return `${ticket.title} can't be collected now.`;
        return `${ticket.title} can't be marked uncollected now.`;
      }
      if (code === "pickup_not_due") {
        try {
          const passport = await api<Passport>(`/api/pieces/${encodeURIComponent(ticket.id)}`);
          const deadline = passport.pickup_deadline ?? "";
          return `${ticket.title} can still be collected until the end of ${screenDate(deadline, me()?.timeZone ?? "UTC")}.`;
        } catch {
          return err.body.message;
        }
      }
      return err.body.message;
    }
    return "No connection. Check the studio wifi and try again.";
  }

  registerRefresh(() => void load());
}
