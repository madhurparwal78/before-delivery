import { api, el, announce, problemText } from "../api.js";

interface Entry {
  id: string;
  title: string;
  artist_name: string;
  status: string;
  images: Array<{ id: string }>;
}

interface Session {
  id: string;
  title: string;
  status: string;
  version: number;
  starts_local: string;
  venue_id: string;
}

export async function renderCurate(root: HTMLElement): Promise<void> {
  const wrap = el("div", { class: "wrap" });
  wrap.append(el("h1", { class: "section-head", text: "Curate" }));
  const statusNode = el("div", { role: "status", "aria-label": "Curation status", text: "" });
  wrap.append(statusNode);

  let tab: "sessions" | "entries" = "sessions";
  const tabsRow = el("div", { class: "tabs", role: "tablist" });
  const sessionsTab = el("button", { text: "Sessions", role: "tab", "aria-selected": "true" });
  const entriesTab = el("button", { text: "Artwork entries", role: "tab", "aria-selected": "false" });
  sessionsTab.addEventListener("click", () => {
    tab = "sessions";
    sessionsTab.setAttribute("aria-selected", "true");
    entriesTab.setAttribute("aria-selected", "false");
    void refresh();
  });
  entriesTab.addEventListener("click", () => {
    tab = "entries";
    entriesTab.setAttribute("aria-selected", "true");
    sessionsTab.setAttribute("aria-selected", "false");
    void refresh();
  });
  tabsRow.append(sessionsTab, entriesTab);
  wrap.append(tabsRow);
  const boardHost = el("div");
  wrap.append(boardHost);

  async function refresh(): Promise<void> {
    boardHost.replaceChildren();
    if (tab === "sessions") {
      const sessions = (await api<{ sessions: Session[] }>("/api/curate/sessions")).sessions;
      const newBtn = el("button", { text: "New session" });
      newBtn.addEventListener("click", () => openNewSession());
      boardHost.append(newBtn);
      boardHost.append(renderBoard(sessions.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        actions: sessionActions(s),
      }))));
    } else {
      const entries = (await api<{ entries: Entry[] }>("/api/entries")).entries;
      boardHost.append(renderBoard(entries.map((e) => ({
        id: e.id,
        title: `${e.title} · ${e.artist_name}`,
        status: e.status,
        actions: entryActions(e),
      }))));
    }
  }

  function renderBoard(cards: Array<{ id: string; title: string; status: string; actions: HTMLElement[] }>): HTMLElement {
    const board = el("div", { class: "board" });
    for (const state of ["draft", "review", "scheduled", "published", "cancelled"]) {
      const col = el("div", { class: "board-column", role: "region", "aria-label": state });
      col.append(el("h3", { text: state }));
      for (const card of cards.filter((c) => c.status === state)) {
        const cardNode = el("div", { class: "card" });
        cardNode.append(el("div", { text: card.title }));
        for (const action of card.actions) cardNode.append(action);
        col.append(cardNode);
      }
      board.append(col);
    }
    return board;
  }

  function sessionActions(session: Session): HTMLElement[] {
    const out: HTMLElement[] = [];
    const mk = (label: string, to: string, extra?: Record<string, string>, needsPublishAt = false): HTMLElement => {
      const btn = el("button", { text: label });
      btn.addEventListener("click", async () => {
        if (needsPublishAt) {
          openScheduleDialog(session.id, session.title);
          return;
        }
        try {
          const res = await api<{ session: Session; refunds_started: number }>(`/api/sessions/${session.id}/transitions`, {
            method: "POST",
            body: JSON.stringify({ to, ...(extra ?? {}) }),
          });
          announce(statusNode, to === "cancelled" && res.refunds_started > 0
            ? `${res.session.title} cancelled. Refunds started for ${res.refunds_started} orders.`
            : `${res.session.title} moved to ${res.session.status}.`);
          await refresh();
        } catch (err) {
          announce(statusNode, problemText(err));
        }
      });
      return btn;
    };
    if (session.status === "draft") out.push(mk(`Send ${session.title} to review`, "review"));
    if (session.status === "review") {
      out.push(mk(`Return ${session.title} to draft`, "draft"));
      out.push(mk(`Schedule ${session.title}`, "scheduled", undefined, true));
    }
    if (session.status === "scheduled") {
      out.push(mk(`Unschedule ${session.title}`, "review"));
      out.push(mk(`Cancel ${session.title}`, "cancelled"));
    }
    if (session.status === "published") {
      out.push(mk(`Cancel ${session.title}`, "cancelled"));
    }
    return out;
  }

  function entryActions(entry: Entry): HTMLElement[] {
    const out: HTMLElement[] = [];
    const mk = (label: string, to: string, extra?: Record<string, string>, needsPublishAt = false): HTMLElement => {
      const btn = el("button", { text: label });
      btn.addEventListener("click", async () => {
        if (needsPublishAt) {
          openEntryScheduleDialog(entry.id, entry.title);
          return;
        }
        try {
          const res = await api<{ entry: Entry }>(`/api/entries/${entry.id}/transitions`, {
            method: "POST",
            body: JSON.stringify({ to, ...(extra ?? {}) }),
          });
          announce(statusNode, `${res.entry.title} moved to ${res.entry.status}.`);
          await refresh();
        } catch (err) {
          announce(statusNode, problemText(err));
        }
      });
      return btn;
    };
    if (entry.status === "draft") out.push(mk(`Send ${entry.title} to review`, "review"));
    if (entry.status === "review") {
      out.push(mk(`Return ${entry.title} to draft`, "draft"));
      out.push(mk(`Schedule ${entry.title}`, "scheduled", undefined, true));
    }
    if (entry.status === "scheduled") {
      out.push(mk(`Unschedule ${entry.title}`, "review"));
      out.push(mk(`Cancel ${entry.title}`, "cancelled"));
    }
    if (entry.status === "published") out.push(mk(`Cancel ${entry.title}`, "cancelled"));
    if (entry.images.length > 0) {
      const view = el("button", { text: "View original" });
      view.addEventListener("click", async () => {
        const res = await api<{ url: string }>(`/api/entries/${entry.id}/images/${entry.images[0].id}/read`, { method: "POST" });
        window.open(res.url, "_blank");
      });
      out.push(view);
    }
    return out;
  }

  function openScheduleDialog(sessionId: string, title: string): void {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Schedule publishing");
    const inner = el("div", { class: "dialog-inner" });
    inner.append(el("h2", { text: "Schedule publishing", id: "schedule-heading", tabindex: "-1" }));
    const input = el("input", { type: "text", "aria-label": "Publish at", placeholder: "2027-10-29T14:30" }) as HTMLInputElement;
    const label = el("label", { text: "Publish at (Brussels wall time)" });
    label.append(input);
    const schedule = el("button", { text: "Schedule" });
    schedule.addEventListener("click", async () => {
      try {
        const res = await api<{ session: Session }>(`/api/sessions/${sessionId}/transitions`, {
          method: "POST",
          body: JSON.stringify({ to: "scheduled", publish_at: input.value }),
        });
        announce(statusNode, `${res.session.title} moved to scheduled.`);
        dialog.close();
        dialog.remove();
        await refresh();
      } catch (err) {
        announce(statusNode, problemText(err));
      }
    });
    const cancel = el("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      dialog.close();
      dialog.remove();
    });
    inner.append(label, schedule, cancel);
    dialog.append(inner);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    void title;
  }

  function openEntryScheduleDialog(entryId: string, title: string): void {
    void entryId;
    void title;
  }

  function openNewSession(): void {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "New session");
    const inner = el("div", { class: "dialog-inner" });
    inner.append(el("h2", { text: "New session", id: "new-session-heading", tabindex: "-1" }));
    const fields: Array<[string, HTMLInputElement]> = [];
    for (const [label, type] of [["Title", "text"], ["Discipline", "text"], ["Venue", "text"], ["Starts local", "text"], ["Ends local", "text"], ["Admission", "text"], ["Capacity", "number"], ["Price full cents", "number"], ["Price reduced cents", "number"], ["Description", "text"]]) {
      const input = el("input", { type, "aria-label": label }) as HTMLInputElement;
      const lab = el("label", { text: label });
      lab.append(input);
      inner.append(lab);
      fields.push([label, input]);
    }
    const create = el("button", { text: "Create session" });
    create.addEventListener("click", async () => {
      const get = (label: string): string => fields.find(([l]) => l === label)?.[1].value ?? "";
      try {
        const session = await api<Session>("/api/sessions", {
          method: "POST",
          body: JSON.stringify({
            title: get("Title"),
            description: get("Description"),
            discipline: get("Discipline"),
            venue_id: get("Venue"),
            admission: get("Admission"),
            starts_local: get("Starts local"),
            ends_local: get("Ends local"),
            capacity: get("Capacity") === "" ? null : Number(get("Capacity")),
            price_full_cents: get("Price full cents") === "" ? null : Number(get("Price full cents")),
            price_reduced_cents: get("Price reduced cents") === "" ? null : Number(get("Price reduced cents")),
          }),
        });
        announce(statusNode, `${session.title} moved to draft.`);
        dialog.close();
        dialog.remove();
        await refresh();
      } catch (err) {
        announce(statusNode, problemText(err));
      }
    });
    const cancel = el("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      dialog.close();
      dialog.remove();
    });
    inner.append(create, cancel);
    dialog.append(inner);
    document.body.append(dialog);
    dialog.showModal();
  }

  root.append(wrap);
  await refresh();
}
