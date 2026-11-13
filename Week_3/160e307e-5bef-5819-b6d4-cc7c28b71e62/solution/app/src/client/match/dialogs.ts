import { h } from "../dom";
import { openDialog } from "../ui/dialog";
import type { DialogHandle } from "../ui/dialog";
import type { BoardEnd } from "../../shared/types";
import type { MatchView } from "./view";

/** The dialogs and sheets of the match screen. */

export function menuDialog(opener: HTMLElement, actions: { rules: () => void; resign: () => void }): DialogHandle {
  const handle = openDialog(
    { title: "Menu", returnFocus: opener },
    h(
      "div",
      { class: "dialog-stack" },
      h("button", { type: "button", class: "btn", onclick: () => { handle.close(); actions.rules(); } }, "Rules"),
      h("button", { type: "button", class: "btn", onclick: () => { handle.close(); actions.resign(); } }, "Resign"),
      h("button", { type: "button", class: "btn btn-ink", onclick: () => handle.close() }, "Close"),
    ),
  );
  return handle;
}

const RULES: readonly string[] = [
  "Touch the baseline with the striker, keep it 36.15 mm or more from every coin, then flick. The break gets three tries to touch a coin.",
  "Pocket your own coins to shoot again. Pocketing only the opponent's coins ends your turn.",
  "Pocket the queen, then cover her with your next pocket. If you miss, she returns to the centre. Before you have an own coin down she returns at once.",
  "A pocketed striker is a foul: one due coin comes back, or is owed and paid with your next pocket.",
  "A board ends when a player pockets their last coin with the queen covered. Points are the coins left on the other side, plus 3 for the queen while your score is below 22.",
  "Pocketing the opponent's last coin, or your own last coin before the queen is covered, gives the board to the opponent with a 3 point penalty.",
  "Classic runs to 25 points or eight boards, with a ninth Extra board on a tie. Quick is a single board.",
  "Every online shot is ruled by the server with the same published model your browser draws.",
];

export function rulesDialog(opener: HTMLElement): DialogHandle {
  const handle = openDialog(
    { title: "Rules", returnFocus: opener },
    h("ul", { class: "rules-list" }, ...RULES.map((line) => h("li", {}, line))),
    h("div", { class: "actions" }, h("button", { type: "button", class: "btn btn-ink", onclick: () => handle.close() }, "Close")),
  );
  return handle;
}

export function resignDialog(opener: HTMLElement, onResign: () => void): DialogHandle {
  const handle = openDialog(
    { title: "Resign this match?", returnFocus: opener },
    h("p", { class: "lede" }, "The other player wins and the scores stay as they are."),
    h(
      "div",
      { class: "actions" },
      h("button", { type: "button", class: "btn btn-ink", onclick: () => { handle.close(); onResign(); } }, "Resign"),
      h("button", { type: "button", class: "btn", onclick: () => handle.close() }, "Keep playing"),
    ),
  );
  return handle;
}

export function boardOverSheet(view: MatchView, end: BoardEnd, onNext: () => void): DialogHandle {
  const winner = view.seats[end.winnerSeat].name;
  let advanced = false;
  const next = (): void => {
    if (advanced) return;
    advanced = true;
    onNext();
  };
  const handle = openDialog(
    { title: `${winner} wins board ${end.board}`, label: "Board over", className: "dialog sheet", returnFocus: document.getElementById("board"), onClose: next },
    h("p", { id: "board-points", class: "lede" }, end.line),
    h("div", { class: "actions" }, h("button", { type: "button", class: "btn btn-ink", autofocus: true, onclick: () => handle.close() }, "Next board")),
  );
  return handle;
}

interface MatchOverContent {
  heading: string;
  finalScore: string;
  boardPoints: string | null;
  endReason: string | null;
  ratingChange: string | null;
  chalk: string | null;
  saveStatus: boolean;
  rematch: boolean;
}

export interface MatchOverHandle {
  dialog: DialogHandle;
  setSaveStatus: (text: string) => void;
  setChalk: (text: string) => void;
  setRematch: (state: { label: string; disabled: boolean; offer: string | null; expired: boolean }) => void;
}

export function matchOverDialog(content: MatchOverContent, actions: { rematch: () => void; accept: () => void }): MatchOverHandle {
  const save = h("p", { id: "save-status", class: "statement-line", role: "status" }, "");
  const chalk = h("p", { id: "chalk-earned", class: "statement-line" }, content.chalk ?? "");
  const rematch = h("button", { type: "button", class: "btn btn-ink", onclick: actions.rematch }, "Rematch");
  const accept = h("button", { type: "button", class: "btn btn-ink", hidden: true, onclick: actions.accept }, "Accept rematch");
  const offer = h("p", { class: "statement-line", role: "status" });
  const dialog = openDialog(
    { title: content.heading, label: "Match over", escapeCloses: false, className: "dialog statement", titleLevel: 2 },
    h(
      "div",
      { class: "statement-body" },
      h("p", { id: "final-score", class: "statement-score" }, content.finalScore),
      content.boardPoints ? h("p", { id: "board-points", class: "statement-line" }, content.boardPoints) : null,
      content.endReason ? h("p", { id: "end-reason", class: "statement-line" }, content.endReason) : null,
      content.ratingChange ? h("p", { id: "rating-change", class: "statement-line" }, content.ratingChange) : null,
      chalk,
      content.saveStatus ? save : null,
      offer,
    ),
    h("div", { class: "actions" }, content.rematch ? rematch : null, content.rematch ? accept : null, h("a", { href: "/", class: "btn" }, "Home")),
  );
  return {
    dialog,
    setSaveStatus: (text) => {
      save.textContent = text;
    },
    setChalk: (text) => {
      chalk.textContent = text;
    },
    setRematch: (state) => {
      rematch.textContent = state.label;
      rematch.disabled = state.disabled;
      accept.hidden = state.offer === null;
      offer.textContent = state.offer ?? (state.expired ? "Rematch offer expired." : "");
    },
  };
}
