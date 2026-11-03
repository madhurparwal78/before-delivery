// The live match as this browser sees it: the current round, the latest broadcast tick and the camera's subject.
import { get } from "./api.js";
import { Store } from "./store.js";
import type { Match, Round } from "../shared/api.js";
import { type TickBean, rankBeans } from "../shared/sim.js";
import { type BeanState, type RoundKind } from "../shared/rules.js";

interface Standing extends TickBean {
  rank: number;
  qualifiedTick: number | null;
  eliminatedTick: number | null;
}

export interface LiveView {
  matchId: number;
  match: Match | null;
  round: Round | null;
  tick: number;
  standings: Standing[];
  received: number;
}

export const live = new Store<LiveView | null>(null);
export const banner = new Store<{ text: string; serial: number } | null>(null);

const marks = new Map<number, { qualifiedTick: number | null; eliminatedTick: number | null }>();

export function inPlay(state: BeanState): boolean {
  return state === "alive" || state === "falling" || state === "respawning";
}

export async function followMatch(matchId: number): Promise<void> {
  if (live.get()?.matchId === matchId) return;
  marks.clear();
  live.set({ matchId, match: null, round: null, tick: -1, standings: [], received: 0 });
  const { match } = await get<{ match: Match }>(`/api/matches/${matchId}`);
  live.update((view) => {
    if (view === null || view.matchId !== matchId) return view;
    const current = match.rounds[match.rounds.length - 1] ?? null;
    return { ...view, match, round: view.round ?? current };
  });
}

export function leaveMatch(): void {
  live.set(null);
  marks.clear();
}

export function onRound(matchId: number, round: Round): void {
  const view = live.get();
  if (view === null || view.matchId !== matchId) return;
  if (view.round?.n !== round.n) marks.clear();
  const standings = view.round?.n === round.n ? view.standings : [];
  live.set({ ...view, round, standings, tick: view.round?.n === round.n ? view.tick : -1 });
}

function rank(kind: RoundKind, beans: TickBean[], tick: number): Standing[] {
  const rows = beans.map((bean) => {
    const mark = marks.get(bean.userId) ?? { qualifiedTick: null, eliminatedTick: null };
    if (bean.state === "qualified" && mark.qualifiedTick === null) mark.qualifiedTick = tick;
    if (bean.state === "eliminated" && mark.eliminatedTick === null) mark.eliminatedTick = tick;
    marks.set(bean.userId, mark);
    return { ...bean, ...mark };
  });
  return rankBeans(kind, rows).map((row, index) => ({ ...row, rank: index + 1 }));
}

export function onTick(matchId: number, roundNumber: number, tick: number, beans: TickBean[], selfId: number): void {
  const view = live.get();
  if (view === null || view.matchId !== matchId || view.round === null || view.round.n !== roundNumber) return;
  const before = view.standings.find((row) => row.userId === selfId)?.state;
  const standings = rank(view.round.kind, beans, tick);
  const after = standings.find((row) => row.userId === selfId)?.state;
  if (before !== undefined && after !== undefined && before !== after && (after === "qualified" || after === "eliminated")) {
    const won = after === "qualified" && view.round.kind === "final";
    const text = after === "eliminated" ? "Eliminated" : won ? "You won Pratfall Cup!" : "Qualified!";
    banner.update((current) => ({ text, serial: (current?.serial ?? 0) + 1 }));
  }
  live.set({ ...view, tick, standings, received: view.received + 1 });
}

// Whom the match camera follows: yourself in play, else the lowest-id party friend in play, else the leader in play.
export function cameraSubject(view: LiveView, selfId: number, partyIds: number[], chosen: number | null): number | null {
  const playing = view.standings.filter((row) => inPlay(row.state));
  if (playing.length === 0) return null;
  if (playing.some((row) => row.userId === selfId)) return selfId;
  if (chosen !== null && playing.some((row) => row.userId === chosen)) return chosen;
  const friend = playing.filter((row) => partyIds.includes(row.userId)).sort((a, b) => a.userId - b.userId)[0];
  return friend?.userId ?? playing[0]?.userId ?? null;
}
