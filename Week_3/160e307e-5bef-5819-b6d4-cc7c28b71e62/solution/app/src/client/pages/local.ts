import { ApiFail, post } from "../api";
import { app } from "../app";
import { h } from "../dom";
import { MODEL_VERSION, otherSeat } from "../../shared/constants";
import { newMatchState, ruleEnd } from "../../shared/rules";
import { playShot } from "../../shared/shot";
import type { LoggedShot } from "../../shared/shot";
import type { Format, MatchState, Seat } from "../../shared/types";
import { MatchScreen } from "../match/screen";
import { fromLocal, rulingFromOutcome } from "../match/view";
import type { MatchView } from "../match/view";
import type { Mount } from "../router";
import { topBar } from "../ui/shell";

/** Pass and play: the whole match runs in this browser on the shared rules, then the result is sent to be replayed. */

const PENDING_KEY = "dc_pending_local";

interface Pending {
  body: Record<string, unknown>;
}

function pending(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as Pending[];
  } catch {
    return [];
  }
}

function keep(list: Pending[]): void {
  if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  else localStorage.removeItem(PENDING_KEY);
}

/** Sends every match the server could not record yet. Safe to repeat: the idempotency key makes it once. */
export async function syncPendingLocal(): Promise<void> {
  for (const item of pending()) {
    try {
      await post("/api/local-matches", item.body);
    } catch (error) {
      if (error instanceof ApiFail && (error.status === 0 || error.status === 503)) continue;
    }
    keep(pending().filter((p) => p.body.idempotencyKey !== item.body.idempotencyKey));
  }
}

function setup(root: HTMLElement, start: (format: Format, names: [string, string], rotate: boolean) => void): void {
  const radios = (["Quick", "Classic"] as const).map((label, index) => {
    const input = h("input", { type: "radio", name: "format", value: label.toLowerCase(), id: `local-${label.toLowerCase()}`, "aria-label": label });
    input.checked = index === 0;
    return { label, input };
  });
  const one = h("input", { id: "player-one", type: "text", class: "text-input", maxlength: 24, value: "Player 1", "aria-label": "Player 1 name", autocomplete: "off" });
  const two = h("input", { id: "player-two", type: "text", class: "text-input", maxlength: 24, value: "Player 2", "aria-label": "Player 2 name", autocomplete: "off" });
  const turn = h("input", { type: "checkbox", role: "switch", id: "turn-board", class: "switch-input", "aria-label": "Turn the board each turn", checked: true });
  turn.checked = true;
  root.replaceChildren(
    h(
      "div",
      { class: "working local field-tomato" },
      topBar(true),
      h(
        "form",
        {
          class: "working-body local-form",
          novalidate: true,
          onsubmit: (event) => {
            event.preventDefault();
            start(radios[1]?.input.checked ? "classic" : "quick", [one.value.trim() || "Player 1", two.value.trim() || "Player 2"], turn.checked);
          },
        },
        h("h1", { class: "page-title", tabindex: -1 }, "Pass and play"),
        h("p", { class: "lede" }, "Two people, one device. Player 1 plays white and breaks the first board."),
        h("div", { role: "radiogroup", "aria-label": "Format", class: "segmented" }, ...radios.map(({ label, input }) => h("label", { class: "segment", for: input.id }, input, h("span", {}, label)))),
        h("label", { class: "label", for: "player-one" }, "Player 1"),
        one,
        h("label", { class: "label", for: "player-two" }, "Player 2"),
        two,
        h("label", { class: "switch", for: "turn-board" }, turn, h("span", { class: "switch-track", "aria-hidden": "true" }), h("span", { class: "switch-label" }, "Turn the board each turn")),
        h("div", { class: "actions" }, h("button", { type: "submit", class: "btn btn-ink" }, "Start")),
      ),
    ),
  );
}

const local: Mount = ({ root }) => {
  let screen: MatchScreen | null = null;
  setup(root, (format, names, rotate) => {
    let state: MatchState = newMatchState(format, 0);
    const shots: LoggedShot[] = [];
    const skin = app.me?.equipped.striker ?? "striker-ply";
    let seq = 0;
    const view = (): MatchView => fromLocal(state, names, seq, skin);
    screen = new MatchScreen(
      {
        mode: "local",
        viewer: null,
        rotateBoard: rotate,
        look: { board: app.me?.equipped.board ?? "board-ply", coins: app.me?.equipped.coins ?? "coins-ivory" },
        callbacks: {
          shoot: (intent) => {
            const seat = state.turn;
            const outcome = playShot(state, seat, intent);
            shots.push({ seat, ...intent });
            state = outcome.next;
            seq += 1;
            return Promise.resolve(rulingFromOutcome(outcome, view(), seat));
          },
          preview: () => undefined,
          emote: () => undefined,
          rematch: () => undefined,
          resync: () => undefined,
          resignHere: () => {
            state = ruleEnd(state, state.turn, "resigned");
            seq += 1;
            screen?.applyState(view());
          },
          finished: (final, notify) => {
            const body = {
              format,
              players: [{ name: names[0] }, { name: names[1] }],
              shots,
              resignedSeat: final.endReason === "resigned" ? otherSeat(final.winnerSeat as Seat) : null,
              claimed: { winnerSeat: final.winnerSeat, scores: [final.seats[0].score, final.seats[1].score] },
              modelVersion: MODEL_VERSION,
              idempotencyKey: crypto.randomUUID(),
            };
            post<{ chalkEarned: number }>("/api/local-matches", body).then(
              (saved) => notify("Saved to your history.", `+${saved.chalkEarned} chalk`),
              () => {
                keep([...pending(), { body }]);
                notify("Saved on this device. It will be added to your history when online.", null);
              },
            );
          },
        },
      },
      view(),
    );
    root.replaceChildren(screen.element);
    (screen.element.querySelector("#board") as HTMLElement | null)?.focus({ preventScroll: true });
  });
  return () => screen?.destroy();
};

export default local;
