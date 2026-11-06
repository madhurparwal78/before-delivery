import { el, clear, announce, mountStatus } from "./ui.js";
import { api } from "./api.js";
import { state, refreshMe } from "./state.js";
import { openSignInDialog } from "./authDialog.js";

interface CheckinPayload {
  q: string;
  venue_date: string;
  open_day: 1 | 2 | null;
  results: { reservation_id: string; attendee_name: string; bench: string; day1: boolean; day2: boolean }[];
}

/**
 * The front-desk check-in screen: search by name, check the day's attendee in
 * with the keyboard only. The matches always belong to the current text.
 */
export function buildCheckin(root: HTMLElement): void {
  let latestSearch = 0;
  let debounce = 0;
  let payload: CheckinPayload | null = null;

  async function load(): Promise<void> {
    await refreshMe();
    render();
  }

  function render(): void {
    clear(root);
    const me = state.me;
    const wrap = el("div", { class: "staff-page" });
    if (!me) {
      wrap.append(
        el("h1", { class: "chapter-title" }, "Check-in"),
        el("p", { class: "lede" }, "Sign in as front desk to open check-in.")
      );
      const signIn = el("button", { class: "btn btn-live" }, "Sign in");
      signIn.addEventListener("click", () => openSignInDialog(signIn, load));
      wrap.append(signIn);
      root.append(wrap);
      return;
    }
    if (me.account.role !== "frontdesk") {
      wrap.append(
        el("h1", { class: "chapter-title" }, "Check-in"),
        el("p", { class: "hint" }, "This screen is for front-desk staff.")
      );
      const out = el("button", { class: "btn btn-quiet" }, "Sign out");
      out.addEventListener("click", async () => {
        await api("/api/auth/signout", { method: "POST" });
        await refreshMe();
        render();
      });
      wrap.append(out);
      root.append(wrap);
      return;
    }
    root.append(wrap);
    buildLive(wrap);
  }

  function buildLive(wrap: HTMLElement): void {
    const heading = el("h1", { class: "chapter-title", id: "checkin-heading", tabindex: "-1" }, "Check-in is closed today");
    const searchBox = el("input", {
      class: "staff-search",
      type: "search",
      "aria-label": "Attendee name",
      placeholder: "Attendee name",
    }) as HTMLInputElement;
    const matchList = el("ul", { class: "match-list", "aria-label": "Matches", id: "match-list" });

    wrap.append(heading, searchBox, matchList);
    mountStatus(wrap, "Check-in updates");

    async function search(): Promise<void> {
      const searchId = ++latestSearch;
      const q = searchBox.value.trim();
      if (q.length < 2) {
        payload = { q, venue_date: "", open_day: null, results: [] };
        renderMatches();
        return;
      }
      try {
        const res = await api<CheckinPayload>(`/api/checkin?q=${encodeURIComponent(q)}`);
        if (searchId !== latestSearch) return;
        payload = res;
        renderMatches();
        announceCheckin(
          payload.results.length > 0
            ? `Found ${payload.results.length} for "${q}".`
            : `No attendee matches "${q}".`
        );
      } catch {
        if (searchId !== latestSearch) return;
      }
    }

    function renderMatches(): void {
      clear(matchList);
      const openDay = payload?.open_day ?? null;
      heading.textContent = openDay === 1 ? "Day 1 check-in" : openDay === 2 ? "Day 2 check-in" : "Check-in is closed today";
      for (const result of payload?.results ?? []) {
        const btn = el("button", { class: "btn btn-quiet" }, `Check in ${result.attendee_name} for day ${openDay}`);
        btn.addEventListener("click", () => checkIn(result, btn));
        matchList.append(el("li", {}, btn));
      }
    }

    async function checkIn(result: { reservation_id: string; attendee_name: string; bench: string }, opener: HTMLElement): Promise<void> {
      const day = payload?.open_day;
      if (!day) return;
      try {
        await api("/api/checkin", {
          method: "POST",
          body: JSON.stringify({ reservation_id: result.reservation_id, day }),
        });
        await search();
        announceCheckin(`${result.attendee_name} checked in for day ${day}.`);
        searchBox.focus();
        searchBox.select();
      } catch (e) {
        const body = (e as { body?: { error?: string; message?: string } }).body;
        if (body?.error === "already_checked_in") {
          announceCheckin(`${result.attendee_name} is already checked in for day ${day}.`);
        } else if (body?.error === "balance_due") {
          announceCheckin(`${result.attendee_name} has a balance due. Send them to the registrar.`);
        } else if (body?.error === "not_checked_in_day1") {
          announceCheckin(`${result.attendee_name} has no day 1 check-in. Send them to the registrar.`);
        } else if (body?.error === "no_attendee") {
          announceCheckin("This seat has no attendee yet. Send them to the registrar.");
        } else if (body?.error === "checkin_closed") {
          announceCheckin("Check-in is closed today.");
        } else {
          announceCheckin(body?.message ?? "That did not work.");
        }
        opener.focus();
      }
    }

    searchBox.addEventListener("input", () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(search, 200);
    });

    searchBox.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        matchList.querySelector<HTMLElement>("button")?.focus();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const buttons = Array.from(matchList.querySelectorAll<HTMLElement>("button"));
        if (buttons.length === 1 && payload?.q === searchBox.value.trim()) {
          buttons[0]!.click();
        }
        return;
      }
    });

    matchList.addEventListener("keydown", (event) => {
      const buttons = Array.from(matchList.querySelectorAll<HTMLElement>("button"));
      const index = buttons.indexOf(document.activeElement as HTMLElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        buttons[index + 1]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (index === 0) {
          searchBox.focus();
        } else {
          buttons[index - 1]?.focus();
        }
      }
    });

    // The search shortcut: / focuses the search box.
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || !document.querySelector("#checkin-heading")) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      event.preventDefault();
      searchBox.focus();
    });

    function announceCheckin(message: string): void {
      announce("Check-in updates", message);
    }

    // Initial day heading from the server.
    (async () => {
      try {
        const res = await api<CheckinPayload>("/api/checkin?q=zz");
        payload = { ...res, results: [] };
        renderMatches();
      } catch {
        payload = { q: "", venue_date: "", open_day: null, results: [] };
      }
    })();
  }

  load();
}
