import type { PlayerView, StoredEvent } from "../../shared/schemas";

type PlayState = {
  view: PlayerView;
  seated: number;
  // Status copy that replaces the room-state copy until the next room-state change.
  override: string | null;
  answered: boolean;
  chosen: number | null;
  superseded: boolean;
  gone: boolean;
};

type PlayAction =
  | { type: "loaded"; view: PlayerView }
  | { type: "event"; event: StoredEvent }
  | { type: "status"; text: string; answered?: boolean; chosen?: number | null }
  | { type: "locked" }
  | { type: "superseded" }
  | { type: "gone" };

export function standingOf(view: PlayerView): { rank: number; score: number } {
  const mine = view.standings.find((row) => row.seatId === view.you.seatId) as PlayerView["standings"][number];
  return { rank: mine.rank, score: mine.score };
}

const loadedState = (view: PlayerView): PlayState => ({
  view,
  seated: view.standings.length,
  override: null,
  answered: view.you.answeredCurrent,
  chosen: null,
  superseded: false,
  gone: view.state === "ended",
});

export function playReducer(state: PlayState | null, action: PlayAction): PlayState | null {
  if (action.type === "loaded") return state === null || action.view.lastEventId >= state.view.lastEventId ? loadedState(action.view) : state;
  if (state === null) return null;
  const { view } = state;
  switch (action.type) {
    case "status":
      return { ...state, override: action.text, answered: action.answered ?? state.answered, chosen: action.chosen === undefined ? state.chosen : action.chosen };
    case "locked":
      return view.state === "question_open" ? { ...state, view: { ...view, state: "locked" } } : state;
    case "superseded":
      return { ...state, superseded: true };
    case "gone":
      return { ...state, gone: true, view: { ...view, state: "ended" } };
    case "event": {
      const { event } = action;
      if (event.id <= view.lastEventId) return state;
      const next = { ...view, lastEventId: event.id };
      switch (event.type) {
        case "player_joined":
        case "presence":
        case "answer_count":
          return { ...state, view: next, seated: event.data.seated };
        case "question_open":
          return { ...state, view: { ...next, state: event.type, questionIndex: event.data.index, question: event.data, reveal: null, you: { ...view.you, answeredCurrent: false } }, override: null, answered: false, chosen: null };
        case "locked":
          return { ...state, view: { ...next, state: event.type }, override: null };
        case "reveal":
          return { ...state, view: { ...next, state: event.type, reveal: event.data }, override: null };
        case "leaderboard":
          return { ...state, view: { ...next, state: event.type, question: null, standings: event.data.standings }, override: null };
        case "podium":
          return { ...state, view: { ...next, state: event.type, question: null, reveal: null, standings: event.data.standings }, override: null };
        case "ended":
          return { ...state, view: { ...next, state: event.type, question: null }, override: null, gone: true };
      }
    }
  }
}

export function stateCopy(state: PlayState, nickname: string): string {
  if (state.superseded) return "This seat is now open on another screen.";
  const { view } = state;
  switch (view.state) {
    case "lobby":
      return `You're in, ${nickname}. Watch the big screen.`;
    case "question_open":
      return state.answered ? "Locked in" : `Question ${view.questionIndex} is open`;
    case "locked":
      return "Time's up";
    case "reveal":
      return "Answers are in";
    case "leaderboard":
      return "Leaderboard is on the big screen";
    case "podium":
      return "Podium time — watch the big screen";
    case "ended":
      return "The night is over. Thanks for playing.";
  }
}
