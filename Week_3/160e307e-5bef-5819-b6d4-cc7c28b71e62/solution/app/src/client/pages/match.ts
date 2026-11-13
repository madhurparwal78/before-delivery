import { ApiFail, get, post } from "../api";
import { app, pageStatus } from "../app";
import { go } from "../router";
import type { Mount } from "../router";
import { MatchScreen } from "../match/screen";
import { fromWire } from "../match/view";
import type { RulingView, WireMatch } from "../match/view";
import { connect, reconnectToken } from "../socket";
import type { Message } from "../socket";
import { deniedPage } from "../ui/shell";
import type { Seat, BoardEnd, FrameSample, PieceState, ShotEvents, Verdict } from "../../shared/types";

interface WireRuling {
  shotSeq: number;
  seat: Seat;
  events: ShotEvents;
  verdict: Verdict;
  frames: FrameSample[];
  final: PieceState[];
  boardEnd: BoardEnd | null;
  match: WireMatch;
}

function toRuling(wire: WireRuling): RulingView {
  return { ...wire, match: fromWire(wire.match) };
}

/** The online match: every shot is ruled by the server and arrives on both screens. */
const match: Mount = async ({ root, params }) => {
  const id = params[0] ?? "";
  let wire: WireMatch;
  try {
    wire = await get<WireMatch>(`/api/matches/${id}`);
  } catch (error) {
    root.replaceChildren(deniedPage(error instanceof ApiFail && error.status === 503 ? "Online play is unavailable right now." : "Match not found"));
    return undefined;
  }
  const me = app.me;
  const initial = fromWire(wire);
  const viewer = initial.seats.findIndex((s) => s.playerId === me?.id);
  if (!me || viewer < 0 || initial.status === "abandoned") {
    root.replaceChildren(deniedPage(initial.status === "abandoned" ? "Match abandoned" : "Match not found"));
    return undefined;
  }

  let socket: ReturnType<typeof connect> | null = null;
  const resync = (): void => {
    void get<WireMatch>(`/api/matches/${id}`).then((fresh) => screen.applyState(fromWire(fresh)), () => undefined);
  };
  const screen = new MatchScreen(
    {
      mode: "online",
      viewer: viewer as Seat,
      rotateBoard: true,
      look: { board: me.equipped.board, coins: me.equipped.coins },
      callbacks: {
        shoot: async (intent, seq) =>
          toRuling(await post<WireRuling>(`/api/matches/${id}/shots`, { shotSeq: seq, ...intent, modelVersion: app.config?.modelVersion ?? "dc-model-1" })),
        preview: (p) => socket?.send({ type: "aim", ...p }),
        emote: (emote) => void post(`/api/matches/${id}/emotes`, { emote }).catch(() => undefined),
        rematch: (accept) =>
          void post<{ status: "offered" | "accepted" | "declined" | "expired"; matchId: string | null }>(`/api/matches/${id}/rematch`, { accept }).then(
            (result) => {
              if (result.status === "accepted" && result.matchId) go(`/match/${result.matchId}`);
              else screen.setRematchView({ status: result.status, offeredBy: viewer as Seat, matchId: null, remainingMs: null });
            },
            () => undefined,
          ),
        resync,
        finished: () => undefined,
        resignHere: () => void post(`/api/matches/${id}/resign`).catch(() => undefined),
      },
    },
    initial,
  );
  root.replaceChildren(screen.element);

  const handle = (message: Message): void => {
    switch (message.type) {
      case "state":
        screen.applyState(fromWire(message.match as WireMatch));
        break;
      case "shotStarted":
        screen.shotStarted();
        break;
      case "shotResult":
        screen.playRuling(toRuling(message as unknown as WireRuling));
        break;
      case "preview":
        screen.showGhost(message.seat as Seat, message as unknown as { x: number; dx: number; dy: number; p: number });
        break;
      case "opponentStatus":
        screen.setOpponent({ connected: Boolean(message.connected), reconnectRemainingMs: (message.reconnectRemainingMs as number | null) ?? null });
        break;
      case "emote":
        screen.receiveEmote(message.seat as Seat, String(message.emote));
        break;
      case "rematchStatus":
        if (message.status === "accepted" && message.matchId) go(`/match/${String(message.matchId)}`);
        else screen.setRematchView({ status: message.status as "offered", offeredBy: message.offeredBy as Seat, matchId: null, remainingMs: null });
        break;
      default:
        break;
    }
  };
  socket = connect(`/ws?match=${id}&token=${reconnectToken()}`, handle, true);
  const clock = window.setInterval(() => screen.tickClock(), 250);
  return () => {
    window.clearInterval(clock);
    socket?.close();
    screen.destroy();
    pageStatus("");
  };
};

export default match;

