import { el } from "./app.js";
import type { Match, SlotValue } from "../shared/types.js";
import { STATE_WORDS, slotName } from "../shared/types.js";

export interface CardView {
  isOrganizer: boolean;
  onOpen: (match: Match, cardEl: HTMLElement) => void;
}

/** The visible, accessible name of a match card in every state. */
export function cardAccessibleName(m: Match, isOrganizer: boolean): string {
  const upper = slotName(m.upper);
  const lower = slotName(m.lower);
  const pair = `${upper} vs ${lower}`;
  const overdue = isOrganizer && m.overdue ? ", overdue" : "";
  if (m.state === "bye") {
    const real = upper === "bye" ? lower : upper;
    return `${m.label}: ${real} vs bye`;
  }
  if (m.state === "not_needed") return `${m.label}: not needed`;
  if (m.state === "waiting") {
    return m.upper !== null && m.lower !== null
      ? `${m.label}: ${pair}, not played`
      : "Grand final reset: waiting for grand final";
  }
  switch (m.state) {
    case "pending":
      return `${m.label}: ${pair}, not played${overdue}`;
    case "called":
      return `${m.label}: ${pair}, called${overdue}`;
    case "reported": {
      const opponent = opponentOf(m);
      const u = m.report?.upper_games ?? m.upper_games;
      const l = m.report?.lower_games ?? m.lower_games;
      return `${m.label}: ${pair}, ${u}-${l} reported by ${m.report?.by ?? ""}, awaiting ${opponent}`;
    }
    case "disputed":
      return `${m.label}: ${pair}, disputed`;
    case "confirmed":
    case "resolved": {
      const winner = m.winner === "draw" ? null : m.winner === "upper" ? upper : lower;
      const tail = m.winner === "draw" ? ", draw" : `, ${winner} wins`;
      return `${m.label}: ${pair}, ${m.upper_games}-${m.lower_games}${tail}`;
    }
  }
}

function opponentOf(m: Match): string {
  const by = m.report?.by ?? "";
  if (m.upper && "entrant_id" in m.upper && m.upper.name === by) {
    return m.lower && "entrant_id" in m.lower ? m.lower.name : "";
  }
  return m.upper && "entrant_id" in m.upper ? m.upper.name : "";
}

export function slotClass(slot: SlotValue): string {
  return slot === null ? "slot-tbd" : "";
}

export function createMatchCard(m: Match, view: CardView): HTMLButtonElement {
  const name = cardAccessibleName(m, view.isOrganizer);
  const card = el("button", {
    class: `match-card match-card--${m.state}`,
    ariaLabel: name,
    data: {
      matchId: m.id,
      round: String(m.round),
      match: String(m.number),
      bracket: m.bracket,
      state: m.state,
    },
    on: { click: () => view.onOpen(m, card) },
  });
  drawCardContent(card, m, view.isOrganizer);
  return card;
}

export function drawCardContent(card: HTMLElement, m: Match, isOrganizer: boolean): void {
  while (card.firstChild) card.removeChild(card.firstChild);
  const upper = slotName(m.upper);
  const lower = slotName(m.lower);
  const reportedScore = m.report ? `${m.report.upper_games}-${m.report.lower_games}` : null;
  const score =
    m.state === "reported"
      ? (reportedScore ?? `${m.upper_games}-${m.lower_games}`)
      : m.state === "confirmed" || m.state === "resolved"
        ? `${m.upper_games}-${m.lower_games}`
        : "";
  card.appendChild(el("div", { class: "card-label" }, [m.label]));
  if (m.state === "bye") {
    const real = upper === "bye" ? lower : upper;
    card.appendChild(el("div", { class: "card-slots" }, [el("span", {}, [real]), el("span", { class: slotClass(m.lower) }, ["bye"])]));
  } else if (m.state === "not_needed") {
    card.appendChild(el("div", { class: "card-slots" }, [el("span", { class: "slot-tbd" }, ["Not needed"])]));
  } else if (m.state === "waiting" && (m.upper === null || m.lower === null)) {
    card.appendChild(el("div", { class: "card-slots" }, [el("span", { class: "slot-tbd" }, ["Waiting for grand final"])]));
  } else {
    const slots = el("div", { class: "card-slots" }, [
      el("span", { class: slotClass(m.upper) }, [upper]),
      el("span", { class: slotClass(m.lower) }, [lower]),
    ]);
    if (score) {
      slots.appendChild(el("span", { class: "card-score num" }, [score]));
    }
    card.appendChild(slots);
  }
  const statusWord = STATE_WORDS[m.state];
  const statusBits: string[] = [statusWord];
  if (isOrganizer && m.overdue) statusBits.push("Overdue");
  card.appendChild(el("span", { class: "card-status" }, [statusBits.join(" · ")]));
}

export function updateMatchCard(m: Match, view: CardView): void {
  const card = document.querySelector<HTMLElement>(`[data-match-id="${m.id}"]`);
  if (!card) return;
  card.className = `match-card match-card--${m.state}`;
  card.setAttribute("aria-label", cardAccessibleName(m, view.isOrganizer));
  card.dataset.state = m.state;
  drawCardContent(card, m, view.isOrganizer);
}
