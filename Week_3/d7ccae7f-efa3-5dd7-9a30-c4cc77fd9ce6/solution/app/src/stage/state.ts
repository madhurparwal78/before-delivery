import type { HostRoom, StoredEvent } from "../../shared/schemas";

type StageState = {
  room: HostRoom;
  // How the current reveal and podium are shown: animated when they arrive live, at once when resumed or replayed.
  revealMode: "animate" | "instant";
  podiumMode: "animate" | "instant";
  endReason: "host" | "idle";
  refusal: string | null;
};

type StageAction =
  | { type: "loaded"; room: HostRoom }
  | { type: "event"; event: StoredEvent; replay: boolean }
  | { type: "refused"; text: string }
  | { type: "cleared" };

function applyEvent(room: HostRoom, event: StoredEvent): HostRoom {
  const next: HostRoom = { ...room, lastEventId: event.id };
  switch (event.type) {
    case "player_joined":
      return {
        ...next,
        seated: event.data.seated,
        players: room.players.some((p) => p.seatId === event.data.seatId)
          ? room.players
          : [...room.players, { seatId: event.data.seatId, nickname: event.data.nickname, score: 0, rank: event.data.seated, connected: false }],
      };
    case "presence": {
      const known = new Map(room.players.map((p) => [p.seatId, p]));
      return {
        ...next,
        seated: event.data.seated,
        connected: event.data.connected,
        players: event.data.players.map((p) => ({ score: 0, rank: 0, ...known.get(p.seatId), seatId: p.seatId, nickname: p.nickname, connected: p.connected })),
      };
    }
    case "question_open":
      return { ...next, state: event.type, questionIndex: event.data.index, question: event.data, answered: 0, reveal: null };
    case "answer_count":
      return { ...next, answered: event.data.answered, seated: event.data.seated };
    case "locked":
    case "ended":
      return { ...next, state: event.type };
    case "reveal":
      return { ...next, state: event.type, reveal: event.data };
    case "leaderboard":
      return { ...next, state: event.type, question: null, standings: event.data.standings };
    case "podium":
      return { ...next, state: event.type, question: null, reveal: null, standings: event.data.standings };
  }
}

// A room loaded from the server is shown as it stands: a resumed reveal or podium appears at once.
export function stageReducer(state: StageState | null, action: StageAction): StageState | null {
  if (action.type === "loaded") return { room: action.room, revealMode: "instant", podiumMode: "instant", endReason: "host", refusal: null };
  if (state === null) return null;
  switch (action.type) {
    case "refused":
      return { ...state, refusal: action.text };
    case "cleared":
      return { ...state, refusal: null };
    case "event": {
      if (action.event.id <= state.room.lastEventId) return state;
      const room = applyEvent(state.room, action.event);
      const mode = action.replay ? "instant" : "animate";
      return {
        room,
        revealMode: action.event.type === "reveal" ? mode : state.revealMode,
        podiumMode: action.event.type === "podium" ? mode : state.podiumMode,
        endReason: action.event.type === "ended" ? action.event.data.reason : state.endReason,
        refusal: null,
      };
    }
  }
}

export function stageStatus(state: StageState): string {
  if (state.refusal) return state.refusal;
  const { room } = state;
  switch (room.state) {
    case "lobby":
      return "";
    case "question_open":
      return `Question ${room.questionIndex} open`;
    case "locked":
      return "Locked";
    case "reveal":
      return "Revealed";
    case "leaderboard":
      return "Leaderboard";
    case "podium":
      return "Podium";
    case "ended":
      return state.endReason === "idle" ? "Night ended because the room sat empty." : "Night ended";
  }
}
