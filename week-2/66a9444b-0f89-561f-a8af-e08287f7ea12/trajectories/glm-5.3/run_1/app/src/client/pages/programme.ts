import { api, el, eur, me, rowWhen, announce, clock } from "../api.js";
import type { Programme, Session } from "../api.js";
import { buildModel, createLattice, drawStaticSvg, type LatticeState, type LatticeView } from "../lattice.js";
import { openCheckout } from "./checkout.js";

const AGENDA_KEY = "kerf-agenda";

function loadAgenda(): string[] {
  try {
    const raw = localStorage.getItem(AGENDA_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function saveAgenda(ids: string[]): void {
  localStorage.setItem(AGENDA_KEY, JSON.stringify(ids));
}

export function clashesOf(sessions: Session[], agenda: string[]): Array<[string, string]> {
  const inAgenda = sessions.filter((s) => agenda.includes(s.id));
  const out: Array<[string, string]> = [];
  for (let i = 0; i < inAgenda.length; i += 1) {
    for (let j = i + 1; j < inAgenda.length; j += 1) {
      const a = inAgenda[i];
      const b = inAgenda[j];
      const a0 = new Date(a.starts_at).getTime();
      const a1 = new Date(a.ends_at).getTime();
      const b0 = new Date(b.starts_at).getTime();
      const b1 = new Date(b.ends_at).getTime();
      if (a0 < b1 && b0 < a1) out.push([a.id, b.id]);
    }
  }
  return out;
}

export async function renderProgramme(root: HTMLElement): Promise<void> {
  const programme = await api<Programme>("/api/programme");
  const params = new URLSearchParams(window.location.search);
  let filterDay = params.get("day") ?? "";
  let filterVenue = params.get("venue") ?? "";
  let filterDiscipline = params.get("discipline") ?? "";
  let clashesOnly = params.get("clashes") === "1";
  let agenda = loadAgenda();
  let lattice: LatticeView | null = null;
  let refreshTimer: number | undefined;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const applyFilters = (): Session[] =>
    programme.sessions.filter((s) => {
      if (filterDay !== "" && s.festival_day !== filterDay) return false;
      if (filterVenue !== "" && s.venue_id !== filterVenue) return false;
      if (filterDiscipline !== "" && s.discipline !== filterDiscipline) return false;
      return true;
    });

  const updateUrl = (): void => {
    const url = new URL(window.location.origin + window.location.pathname);
    if (filterDay !== "") url.searchParams.set("day", filterDay);
    if (filterVenue !== "") url.searchParams.set("venue", filterVenue);
    if (filterDiscipline !== "") url.searchParams.set("discipline", filterDiscipline);
    if (clashesOnly) url.searchParams.set("clashes", "1");
    const step = params.get("checkout");
    if (step) url.searchParams.set("checkout", step);
    window.history.replaceState({}, "", url.toString());
  };

  const hero = el("section", { class: "hero", "data-ground": "ink" });
  const heroWrap = el("div", { class: "wrap" });
  heroWrap.append(el("h1", { class: "display-word", text: "Kerf Frequencies 2027" }));
  const latticeFrame = el("div", { class: "lattice-frame" });
  heroWrap.append(latticeFrame);
  const controls = el("div", { class: "lattice-controls", role: "group", "aria-label": "Lattice controls" });
  heroWrap.append(controls);
  hero.append(heroWrap);
  root.append(hero);

  const schedule = el("section", { class: "section-paper", "data-ground": "paper", role: "region", "aria-label": "Schedule" });
  const scheduleWrap = el("div", { class: "wrap two-col" });
  const scheduleList = el("div");
  scheduleWrap.append(scheduleList);
  const agendaPanel = el("aside", { class: "agenda-panel", role: "complementary", "aria-label": "My agenda" });
  scheduleWrap.append(agendaPanel);
  schedule.append(scheduleWrap);
  root.append(schedule);

  const story = el("section", { class: "section-blue", "data-ground": "blue", role: "region", "aria-label": "The festival in three statements" });
  const storyWrap = el("div", { class: "wrap" });
  storyWrap.append(el("h2", { class: "section-head", text: "Four days. Five venues. One lattice." }));
  const storyStage = el("div", { class: "story-stage" });
  const storyStatements = ["Four days.", "Five venues.", "One lattice."];
  for (const line of storyStatements) {
    storyStage.append(el("p", { text: line }));
  }
  storyWrap.append(storyStage);
  story.append(storyWrap);
  root.append(story);

  const gallerySection = el("section", { class: "section-vermilion", "data-ground": "vermilion", role: "region", "aria-label": "Gallery", id: "gallery" });
  const galleryWrap = el("div", { class: "wrap" });
  galleryWrap.append(el("h2", { class: "section-head", text: "Gallery" }));
  const galleryBand = el("div", { class: "gallery-band" });
  galleryWrap.append(galleryBand);
  gallerySection.append(galleryWrap);
  root.append(gallerySection);

  const ticketsSection = el("section", { class: "section-paper", "data-ground": "paper", id: "tickets", role: "region", "aria-label": "Tickets" });
  const ticketsWrap = el("div", { class: "wrap" });
  ticketsWrap.append(el("h2", { class: "section-head", text: "Tickets" }));
  const ticketsTable = el("table", { class: "ruled", "aria-label": "Pass prices" });
  ticketsWrap.append(ticketsTable);
  ticketsSection.append(ticketsWrap);
  root.append(ticketsSection);

  const footer = el("footer", { class: "site" });
  footer.append(el("div", { class: "wrap", text: "Kerf Collective · Kerf Frequencies 2027 · Brussels" }));
  root.append(footer);

  const statusProgramme = el("div", { role: "status", class: "status-line", text: "" });
  const statusAgenda = el("div", { role: "status", class: "status-line", text: "" });
  const model = buildModel(programme);

  function renderControls(): void {
    controls.replaceChildren();
    const groups: Array<["day" | "venue" | "discipline", string, Array<{ id: string; name: string }>, string]> = [
      ["day", "Day", programme.festival_days.map((d) => ({ id: d.date, name: d.label })), filterDay],
      ["venue", "Venue", programme.venues, filterVenue],
      ["discipline", "Discipline", programme.disciplines, filterDiscipline],
    ];
    for (const [kind, label, options, current] of groups) {
      const row = el("div", { class: "group" });
      for (const option of options) {
        const pressed = current === option.id;
        const btn = el("button", {
          "aria-pressed": pressed ? "true" : "false",
          text: `${label}: ${option.name}`,
        });
        btn.addEventListener("click", () => {
          select(kind, pressed ? "" : option.id);
        });
        row.append(btn);
      }
      controls.append(row);
    }
  }

  function select(kind: "day" | "venue" | "discipline", id: string): void {
    if (kind === "day") filterDay = id;
    if (kind === "venue") filterVenue = id;
    if (kind === "discipline") filterDiscipline = id;
    updateUrl();
    renderAll();
  }

  function latticeState(): LatticeState {
    const raised: string[] = [];
    if (filterDay !== "") raised.push(`day:${filterDay}`);
    if (filterVenue !== "") raised.push(`venue:${filterVenue}`);
    if (filterDiscipline !== "") raised.push(`discipline:${filterDiscipline}`);
    return { raised, lit: agenda, seams: clashesOf(programme.sessions, agenda).map(([a, b]) => `${a}+${b}`) };
  }

  function renderLattice(): void {
    latticeFrame.replaceChildren();
    const state = latticeState();
    if (reduced) {
      latticeFrame.append(drawStaticSvg(model, state));
      return;
    }
    const view = createLattice(model, { onSelect: select }, reduced);
    if (view) {
      lattice = view;
      view.setState(state);
      latticeFrame.append(view.figure);
    } else {
      latticeFrame.append(drawStaticSvg(model, state));
    }
  }

  function renderAgenda(): void {
    agendaPanel.replaceChildren();
    const heading = el("h2", { text: "My agenda", tabindex: "-1" });
    agendaPanel.append(heading);
    const inAgenda = programme.sessions
      .filter((s) => agenda.includes(s.id))
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    if (inAgenda.length === 0) {
      agendaPanel.append(el("p", { text: "Your agenda is empty." }));
    } else {
      const list = el("ul");
      for (const s of inAgenda) {
        const li = el("li");
        li.append(el("div", { text: `${rowWhen(s)} · ${s.title}` }));
        const removeBtn = el("button", { text: `Remove ${s.title} from agenda`, "aria-label": `Remove ${s.title} from agenda` });
        removeBtn.addEventListener("click", () => {
          agenda = agenda.filter((x) => x !== s.id);
          saveAgenda(agenda);
          announce(statusAgenda, `Removed ${s.title} from your agenda.`);
          const n = clashesOf(programme.sessions, agenda).length;
          announce(statusAgenda, n > 0 ? `${n} clashes in your agenda.` : "No clashes in your agenda.");
          renderAll();
          const remaining = agendaPanel.querySelectorAll("li button")[0] as HTMLElement | undefined;
          if (remaining) remaining.focus();
          else heading.focus();
        });
        li.append(removeBtn);
        list.append(li);
      }
      agendaPanel.append(list);
    }
    const checkoutBtn = el("button", { text: "Get tickets for my agenda" });
    checkoutBtn.addEventListener("click", async () => {
      if (!me) {
        window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search + "&checkout=tickets")}`;
        return;
      }
      announce(statusAgenda, "Holding your seats…");
      const seated = inAgenda.filter((s) => s.admission === "seat");
      for (const s of seated) {
        try {
          await api("/api/holds", { method: "POST", body: JSON.stringify({ session_id: s.id, quantity: 1 }) });
        } catch {
          // Sold out or already held: checkout shows the current holds either way.
        }
      }
      openCheckout("tickets");
    });
    agendaPanel.append(checkoutBtn);
    const openBtn = el("button", { text: "Open my agenda", class: "only-narrow" });
    openBtn.addEventListener("click", () => {
      agendaPanel.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
    agendaPanel.append(openBtn);
  }

  function renderSchedule(): void {
    const listEl = el("ul", { class: "session-list", "aria-label": "Sessions" });
    let visible = applyFilters();
    const seamPairs = clashesOf(programme.sessions, agenda);
    if (clashesOnly) {
      visible = visible.filter((s) => agenda.includes(s.id) && seamPairs.some(([a, b]) => a === s.id || b === s.id));
    }
    for (const s of visible) {
      const clashes = seamPairs.filter(([a, b]) => a === s.id || b === s.id).map(([a, b]) => (a === s.id ? b : a));
      const li = el("li");
      li.append(el("div", { class: "when", text: rowWhen(s) }));
      const headingCol = el("div");
      headingCol.append(el("h3", { text: s.title }));
      const metaBits = [
        programme.venues.find((v) => v.id === s.venue_id)?.name ?? s.venue_id,
        programme.disciplines.find((d) => d.id === s.discipline)?.name ?? s.discipline,
      ];
      headingCol.append(el("div", { class: "meta", text: metaBits.join(" · ") }));
      if (s.status === "cancelled") {
        headingCol.append(el("div", { class: "cancelled-tag", text: "Cancelled" }));
      }
      for (const other of clashes) {
        const otherSession = programme.sessions.find((x) => x.id === other);
        headingCol.append(el("div", { class: "clash-mark", text: `Clash with ${otherSession?.title ?? other}` }));
      }
      li.append(headingCol);
      const actionsCol = el("div");
      const inAgenda = agenda.includes(s.id);
      const toggle = el("button", {
        "aria-pressed": inAgenda ? "true" : "false",
        text: inAgenda ? "In agenda" : "Add to agenda",
        "aria-label": `${inAgenda ? "Remove" : "Add"} ${s.title} ${inAgenda ? "from" : "to"} agenda`,
      });
      toggle.addEventListener("click", () => {
        if (inAgenda) {
          agenda = agenda.filter((x) => x !== s.id);
          announce(statusAgenda, `Removed ${s.title} from your agenda.`);
        } else {
          agenda = [...agenda, s.id];
          announce(statusAgenda, `Added ${s.title} to your agenda.`);
        }
        saveAgenda(agenda);
        const n = clashesOf(programme.sessions, agenda).length;
        announce(statusAgenda, n > 0 ? `${n} clashes in your agenda.` : "No clashes in your agenda.");
        renderAll();
      });
      actionsCol.append(toggle);
      if (s.admission === "seat" && s.status !== "cancelled") {
        const seatsText = s.seats_remaining !== null && s.seats_remaining > 0
          ? `${s.seats_remaining} of ${s.capacity} seats left`
          : "Sold out";
        actionsCol.append(el("div", { class: "seats", text: seatsText }));
        if (s.seats_remaining !== null && s.seats_remaining > 0) {
          const holdBtn = el("button", { text: `Hold a seat for ${s.title}`, "aria-label": `Hold a seat for ${s.title}` });
          holdBtn.addEventListener("click", async () => {
            announce(statusProgramme, "Holding your seat…");
            try {
              const hold = await api<{ expires_at: string }>("/api/holds", {
                method: "POST",
                body: JSON.stringify({ session_id: s.id, quantity: 1 }),
              });
              announce(statusProgramme, `Seat held until ${clock(hold.expires_at)}.`);
              openCheckout("tickets");
            } catch (e) {
              const body = (e as { body?: Record<string, unknown> }).body;
              if (body?.error === "sold_out") {
                announce(statusProgramme, "That was the last seat. Join the waitlist to be offered the next one.");
              } else if (body?.error === "unauthenticated") {
                window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
              } else {
                announce(statusProgramme, "Could not hold that seat.");
              }
              void refreshSeats();
            }
          });
          actionsCol.append(holdBtn);
        } else {
          const waitBtn = el("button", { text: `Join waitlist for ${s.title}`, "aria-label": `Join waitlist for ${s.title}` });
          waitBtn.addEventListener("click", async () => {
            try {
              const entry = await api<{ position: number }>(`/api/sessions/${s.id}/waitlist`, { method: "POST" });
              announce(statusProgramme, `You're number ${entry.position} on the waitlist for ${s.title}.`);
            } catch (err) {
              const body = (err as { body?: Record<string, unknown> }).body;
              if (body?.error === "unauthenticated") {
                window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
              } else {
                announce(statusProgramme, "Could not join the waitlist.");
              }
            }
          });
          actionsCol.append(waitBtn);
        }
      }
      li.append(actionsCol);
      listEl.append(li);
    }

    const filterForm = el("div", { class: "filter-bar", role: "region", "aria-label": "Schedule filters" });
    const makeSelect = (label: string, options: Array<{ id: string; name: string }>, current: string, empty: string, apply: (v: string) => void): HTMLElement => {
      const sel = el("select", { "aria-label": label }) as HTMLSelectElement;
      sel.append(el("option", { value: "", text: empty }));
      for (const option of options) {
        sel.append(el("option", { value: option.id, text: option.name, selected: option.id === current ? "selected" : null }));
      }
      sel.addEventListener("change", () => apply(sel.value));
      const lab = el("label", { text: label });
      lab.append(sel);
      return lab;
    };
    filterForm.append(
      makeSelect("Day", programme.festival_days.map((d) => ({ id: d.date, name: d.label })), filterDay, "All days", (v) => {
        filterDay = v;
        updateUrl();
        renderAll();
      }),
      makeSelect("Venue", programme.venues, filterVenue, "All venues", (v) => {
        filterVenue = v;
        updateUrl();
        renderAll();
      }),
      makeSelect("Discipline", programme.disciplines, filterDiscipline, "All disciplines", (v) => {
        filterDiscipline = v;
        updateUrl();
        renderAll();
      }),
    );
    const clashBox = el("input", { type: "checkbox", "aria-label": "Clashes only" }) as HTMLInputElement;
    clashBox.checked = clashesOnly;
    clashBox.addEventListener("change", () => {
      clashesOnly = clashBox.checked;
      updateUrl();
      renderAll();
    });
    const clashLabel = el("label", { text: "Clashes only" });
    clashLabel.append(clashBox);
    filterForm.append(clashLabel);
    const clearBtn = el("button", { text: "Clear filters" });
    clearBtn.addEventListener("click", () => {
      filterDay = "";
      filterVenue = "";
      filterDiscipline = "";
      clashesOnly = false;
      updateUrl();
      renderAll();
    });
    filterForm.append(clearBtn);

    scheduleList.replaceChildren(filterForm, statusProgramme, statusAgenda, listEl);
    const n = visible.length;
    announce(statusProgramme, n === 1 ? "1 session" : `${n} sessions`);
    renderAgenda();
  }

  async function renderGallery(): Promise<void> {
    const data = await api<{ entries: Array<{ id: string; title: string; artist_name: string; images: Array<{ id: string; display_url: string | null }> }> }>("/api/gallery");
    galleryBand.replaceChildren();
    for (const entry of data.entries) {
      const fig = el("figure");
      const frame = el("div", { class: "frame" });
      if (entry.images.length > 0 && entry.images[0].display_url) {
        const img = el("img", { src: entry.images[0].display_url, alt: `${entry.title} display image` });
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        frame.append(img);
      } else {
        // Frames without an image are drawn procedurally from the entry id.
        frame.append(drawProcedural(entry.id));
      }
      fig.append(frame);
      fig.append(el("figcaption", { text: `${entry.title} — ${entry.artist_name}` }));
      galleryBand.append(fig);
    }
  }

  function drawProcedural(id: string): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 400 300");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    let seed = 0;
    for (const ch of id) seed = (seed * 31 + (ch.codePointAt(0) ?? 0)) % 997;
    for (let i = 0; i < 9; i += 1) {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      seed = (seed * 137 + 71) % 997;
      rect.setAttribute("x", String((seed % 20) * 20));
      seed = (seed * 137 + 71) % 997;
      rect.setAttribute("y", String((seed % 15) * 20));
      rect.setAttribute("width", String(30 + (seed % 9) * 20));
      rect.setAttribute("height", "18");
      rect.setAttribute("fill", i % 2 === 0 ? "#d8f23a" : "#f4efe4");
      svg.append(rect);
    }
    return svg;
  }

  function renderTickets(): void {
    ticketsTable.replaceChildren();
    const head = el("thead");
    const headRow = el("tr");
    headRow.append(el("th", { text: "Pass" }), el("th", { text: "Full rate" }), el("th", { text: "Reduced rate" }), el("th", { text: "" }));
    head.append(headRow);
    ticketsTable.append(head);
    const body = el("tbody");
    const buyFull = el("button", { text: "Buy full-festival pass", "aria-label": "Buy full-festival pass" });
    buyFull.addEventListener("click", () => {
      if (!me) {
        window.location.href = `/signin?next=${encodeURIComponent("/?checkout=tickets")}`;
        return;
      }
      openCheckout("tickets", [{ product: "full_festival" }]);
    });
    const buyDay = el("button", { text: "Buy day pass", "aria-label": "Buy day pass" });
    buyDay.addEventListener("click", () => {
      if (!me) {
        window.location.href = `/signin?next=${encodeURIComponent("/?checkout=tickets")}`;
        return;
      }
      openCheckout("tickets", [{ product: "day", festival_day: programme.festival_days[0].date }]);
    });
    const rows: Array<[string, number, number, HTMLElement]> = [
      ["Full-festival pass", 9500, 5500, buyFull],
      [`Day pass · ${programme.festival_days[0].label}`, 3500, 2000, buyDay],
    ];
    for (const [title, full, reduced, btn] of rows) {
      const tr = el("tr");
      tr.append(el("td", { text: title }), el("td", { text: eur(full) }), el("td", { text: eur(reduced) }));
      const td = el("td");
      td.append(btn);
      tr.append(td);
      body.append(tr);
    }
    ticketsTable.append(body);
  }

  async function refreshSeats(): Promise<void> {
    const fresh = await api<Programme>("/api/programme");
    const byId = new Map(fresh.sessions.map((s) => [s.id, s]));
    for (const s of programme.sessions) {
      const updated = byId.get(s.id);
      if (updated) {
        s.seats_remaining = updated.seats_remaining;
        s.status = updated.status;
      }
    }
    renderSchedule();
  }

  function renderAll(): void {
    renderControls();
    renderLattice();
    const state = latticeState();
    if (lattice) lattice.setState(state);
    renderSchedule();
    const svg = latticeFrame.querySelector("svg");
    if (svg) {
      svg.setAttribute("data-raised", state.raised.join(","));
      svg.setAttribute("data-lit", state.lit.join(","));
      svg.setAttribute("data-seams", state.seams.join(","));
    }
  }

  renderAll();
  void renderGallery();
  renderTickets();
  refreshTimer = window.setInterval(() => void refreshSeats(), 15000);
  window.addEventListener("beforeunload", () => {
    window.clearInterval(refreshTimer);
    lattice?.destroy();
  });
}
