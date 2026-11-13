import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { LeagueDetail, LeagueSummary, LiveMessage, SquadPlayer, SquadView, Standing } from "../../shared/api.ts";
import { messagesOf, request } from "../api.ts";
import { useAnnouncer } from "../announce.ts";
import { Board, pitchRows, type BoardRow } from "../components/Board.tsx";
import { ChipsBar } from "../components/Chips.tsx";
import { LeagueTable } from "../components/LeagueTable.tsx";
import { LockedBanner, Rail, ViewSwitch } from "../components/Rail.tsx";
import type { Badge, ShirtData } from "../components/Shirt.tsx";
import { deadlineCopy, EVENT_LABEL, millions, money, signed } from "../format.ts";
import { useLive } from "../live.ts";
import { PHONE, REDUCED, useMedia } from "../media.ts";
import { createRelay } from "../relay.ts";
import { navigate, useLocation } from "../router.ts";
import { useApp } from "../store.ts";

// Pick Team: the eleven, the bench and the armbands while the gameweek is open; the live points
// board while it is locked or live (brief: Screens / Pick Team).

interface Board {
  view: SquadView;
  rows: Standing[] | null;
}

interface Shown {
  points: Record<string, number>;
  total: number;
  rows: Standing[] | null;
}

const shownOf = (board: Board): Shown => ({
  points: Object.fromEntries(board.view.players.map((player) => [player.id, player.team_points])),
  total: board.view.gameweek_total,
  rows: board.rows,
});

export function TeamPage() {
  const app = useApp();
  const { search } = useLocation();
  const phone = useMedia(PHONE);
  const reduced = useMedia(REDUCED);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const viewMode = search.get("view") === "list" ? "list" : "pitch";
  const leagueParam = search.get("league");

  const [view, setView] = useState<SquadView | null>(null);
  const [leagueId, setLeagueId] = useState<number | null | undefined>(undefined);
  const leagueRef = useRef<number | null | undefined>(undefined);
  const [shown, setShown] = useState<Shown>({ points: {}, total: 0, rows: null });
  const [roll, setRoll] = useState(0);
  const [move, setMove] = useState(0);
  const [badges, setBadges] = useState<Record<string, Badge>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [updates, announceTeam] = useAnnouncer();
  const [livePoints, announceLive] = useAnnouncer();
  const server = useRef<Board | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const relay = useMemo(
    () =>
      createRelay({
        shirt: (id, points) => setShown((current) => ({ ...current, points: { ...current.points, [id]: points } })),
        total: (total, rolls) => {
          setShown((current) => ({ ...current, total }));
          if (rolls) setRoll((value) => value + 1);
        },
        rows: (rows, moves) => {
          setShown((current) => ({ ...current, rows }));
          if (moves) setMove((value) => value + 1);
        },
        badge: (id, badge, ms) => {
          setBadges((current) => ({ ...current, [id]: badge }));
          setTimeout(() => setBadges((current) => (current[id] === badge ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)) : current)), ms);
        },
      }),
    [],
  );
  useEffect(() => () => relay.stop(), []);

  const enqueue = (task: () => Promise<void>) => {
    chain.current = chain.current.then(task).catch((error: unknown) => console.error(error));
  };

  const fetchBoard = async (): Promise<Board | null> => {
    const id = leagueRef.current;
    const [squad, league] = await Promise.all([
      request<SquadView>("GET", "/api/squad"),
      id ? request<LeagueDetail>("GET", `/api/leagues/${id}`) : Promise.resolve(null),
    ]);
    if (!squad.ok) {
      if (squad.error.error === "no_squad") navigate("/transfers", true);
      return null;
    }
    return { view: squad.data, rows: league?.ok ? league.data.standings : null };
  };

  const applyDirect = (board: Board) => {
    server.current = board;
    relay.apply(() => {
      setView(board.view);
      setShown(shownOf(board));
    });
  };

  const reload = () =>
    enqueue(async () => {
      const board = await fetchBoard();
      if (board) applyDirect(board);
    });

  useEffect(() => {
    enqueue(async () => {
      let id: number | null = leagueParam && /^\d+$/.test(leagueParam) ? Number(leagueParam) : null;
      if (id === null) {
        const mine = await request<{ leagues: LeagueSummary[] }>("GET", "/api/leagues");
        id = mine.ok ? mine.data.leagues[0]?.id ?? null : null;
      }
      leagueRef.current = id;
      setLeagueId(id);
      const board = await fetchBoard();
      if (board) applyDirect(board);
    });
  }, [leagueParam]);

  const onEvent = (message: Extract<LiveMessage, { t: "event" }>) =>
    enqueue(async () => {
      const before = server.current;
      const board = await fetchBoard();
      if (!board) return;
      server.current = board;
      setView(board.view);
      const player = board.view.players.find((p) => p.id === message.player_id);
      const earlier = before?.view.players.find((p) => p.id === message.player_id);
      const teamDelta = player && earlier ? player.team_points - earlier.team_points : 0;
      const rawDelta = message.voided ? -message.points_delta : message.points_delta;
      const label = EVENT_LABEL[message.type];
      if (player && teamDelta !== 0) {
        const total = board.view.gameweek_total;
        announceLive(
          message.voided
            ? `${player.name}: ${label} removed, ${signed(teamDelta)} for your team. Gameweek total ${total}.`
            : `${player.name}: ${label}, ${signed(teamDelta)} for your team. Gameweek total ${total}.`,
        );
        // The tag reads the server's numbers: team points over raw points (x2 captain, x3 Triple Captain).
        const ratio = rawDelta !== 0 ? Math.abs(teamDelta / rawDelta) : 1;
        relay.play(
          {
            playerId: player.id,
            chip: `${signed(teamDelta)}${ratio > 1 ? ` x${ratio}` : ""}`,
            negative: teamDelta < 0,
            shirtPoints: player.team_points,
            total,
            rows: board.rows,
          },
          reducedRef.current,
        );
      } else if (player && rawDelta !== 0) {
        announceLive(`${player.name}: ${label} on your bench, not counted.`);
        relay.apply(() => setShown(shownOf(board)));
        setBadges((current) => ({ ...current, [player.id]: { text: signed(rawDelta), tone: "dim" } }));
        const shownBadge = player.id;
        setTimeout(() => setBadges((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== shownBadge))), 1500);
      } else {
        relay.apply(() => setShown(shownOf(board)));
      }
    });

  useLive((message) => {
    if (message.t === "event") onEvent(message);
    else if (message.t === "gameweek" || message.t === "squad" || message.t === "prices" || message.t === "league") reload();
  });

  const status = app.gameweek?.status ?? view?.gameweek_status ?? "open";
  const number = app.gameweek?.number ?? view?.gameweek ?? 1;
  const editable = status === "open" && view?.editable === true;
  useEffect(() => {
    if (!editable) setSelected(null);
  }, [editable]);

  const players = view?.players ?? [];
  const byId = (id: string) => players.find((p) => p.id === id)!;
  const starters = players.filter((p) => p.slot === "starting");
  const bench = players.filter((p) => p.slot === "bench");
  const captain = players.find((p) => p.captain)?.id ?? "";
  const vice = players.find((p) => p.vice_captain)?.id ?? "";

  const savePicks = async (body: { starting: string[]; bench: string[]; captain: string; vice_captain: string }, success: string, refused: string, key: string) => {
    setPendingKey(key);
    const result = await request<SquadView>("PUT", "/api/picks", { gameweek: view!.gameweek, ...body });
    setPendingKey(null);
    setSelected(null);
    if (result.ok) {
      applyDirect({ view: result.data, rows: server.current?.rows ?? null });
      announceTeam(success);
    } else if (result.error.error === "gameweek_locked" || result.error.error === "gameweek_not_open") {
      announceTeam(deadlineCopy(view!.gameweek), true);
    } else if (result.error.error === "rules_broken") {
      announceTeam(`${refused}: ${messagesOf(result.error)}.`, true);
    } else {
      announceTeam(result.error.message, true);
    }
  };

  const activate = (key: string) => {
    if (!editable || pendingKey) return;
    if (!selected) {
      setSelected(key);
      return;
    }
    if (selected === key) {
      setSelected(null);
      return;
    }
    const a = byId(selected);
    const b = byId(key);
    if (a.slot === "starting" && b.slot === "starting") {
      setSelected(key);
      return;
    }
    const starting = starters.map((p) => p.id);
    const benchIds = bench.map((p) => p.id);
    if (a.slot === "bench" && b.slot === "bench") {
      const i = benchIds.indexOf(a.id);
      const j = benchIds.indexOf(b.id);
      [benchIds[i], benchIds[j]] = [b.id, a.id];
      void savePicks({ starting, bench: benchIds, captain, vice_captain: vice }, "Bench order saved.", "Swap refused", key);
      return;
    }
    // The incoming player takes the outgoing one's place and armband; the server checks every rule.
    const out: SquadPlayer = a.slot === "starting" ? a : b;
    const incoming: SquadPlayer = a.slot === "starting" ? b : a;
    starting[starting.indexOf(out.id)] = incoming.id;
    benchIds[benchIds.indexOf(incoming.id)] = out.id;
    void savePicks(
      {
        starting,
        bench: benchIds,
        captain: captain === out.id ? incoming.id : captain,
        vice_captain: vice === out.id ? incoming.id : vice,
      },
      `${incoming.name} moves into the eleven for ${out.name}.`,
      "Swap refused",
      key,
    );
  };

  const armband = (kind: "captain" | "vice", key: string) => {
    if (!editable || pendingKey) return;
    const player = byId(key);
    const starting = starters.map((p) => p.id);
    const benchIds = bench.map((p) => p.id);
    if (kind === "captain") {
      void savePicks(
        { starting, bench: benchIds, captain: player.id, vice_captain: player.id === vice ? captain : vice },
        `${player.name} is now captain.`,
        "Captain refused",
        key,
      );
    } else {
      void savePicks(
        { starting, bench: benchIds, captain: player.id === captain ? vice : captain, vice_captain: player.id },
        `${player.name} is now vice-captain.`,
        "Captain refused",
        key,
      );
    }
  };

  const shirtOf = (player: SquadPlayer): ShirtData => ({
    id: player.id,
    name: player.name,
    club: player.club,
    position: player.position,
    points: shown.points[player.id] ?? 0,
    figure: status === "open" ? millions(player.price_tenths) : String(shown.points[player.id] ?? 0),
    captain: player.captain,
    vice: player.vice_captain,
    dimmed: player.slot === "bench" && status !== "open" && view?.chip !== "bench_boost",
  });
  const layout = pitchRows(starters, bench);
  const rows: BoardRow[] = [
    ...layout.field.map((group, index) => ({ key: `row-${index}`, items: group.map((p) => ({ kind: "shirt" as const, shirt: shirtOf(p) })) })),
    { key: "bench", bench: true, items: layout.bench.map((p) => ({ kind: "shirt" as const, shirt: shirtOf(p) })) },
  ];

  const setViewMode = (mode: "pitch" | "list") => {
    const next = new URLSearchParams(location.search);
    next.set("view", mode);
    navigate(`/team?${next.toString()}`);
  };

  const leagueBlock =
    leagueId === null ? (
      <p class="empty-note">Join or create a mini league to see it move.</p>
    ) : shown.rows ? (
      <LeagueTable name="League table" rows={shown.rows} me={app.me?.id ?? null} move={move} />
    ) : null;

  if (!view) {
    return (
      <main>
        <p class="loading board-loading">Loading squad…</p>
      </main>
    );
  }
  return (
    <main>
      <LockedBanner />
      <div class="page-head">
        <h1>{status === "open" ? "Pick Team" : `Gameweek ${number} points`}</h1>
        <ViewSwitch view={viewMode} onChange={setViewMode} />
      </div>
      <div class="board">
        <div class="board-main">
          <p class={`updates result-strip${updates.error ? " is-error" : ""}`} role="status" aria-label="Team updates">
            {updates.text}
          </p>
          <p class="updates result-strip" role="status" aria-label="Live points">
            {livePoints.text}
          </p>
          <Board
            view={viewMode}
            rows={rows}
            homeKey={starters.find((p) => p.position === "GK")?.id ?? ""}
            focusKey={focusKey}
            onFocusKey={setFocusKey}
            selected={selected}
            selectable={editable}
            pressedOf={(id) => id === selected}
            pendingKey={pendingKey}
            badges={badges}
            onActivate={activate}
            onEscape={() => setSelected(null)}
            onArmband={armband}
            actions={
              selected && editable ? (
                <div class="toolbar" role="toolbar" aria-label="Player actions">
                  <button type="button" class="btn" onClick={() => armband("captain", selected)}>
                    Make captain
                  </button>
                  <button type="button" class="btn" onClick={() => armband("vice", selected)}>
                    Make vice-captain
                  </button>
                  <button type="button" class="btn btn-quiet" onClick={() => setSelected(null)}>
                    Cancel selection
                  </button>
                </div>
              ) : (
                <p class="hint">
                  {editable
                    ? "Choose a shirt, then a second one to swap them. C sets the captain, V the vice-captain."
                    : "The team is locked. Each shirt shows its points for this gameweek."}
                </p>
              )
            }
          />
          {phone && leagueBlock}
        </div>
        <Rail
          phone={phone}
          figures={{
            bank: money(view.bank_tenths),
            squadValue: money(view.squad_value_tenths),
            freeTransfers: String(view.free_transfers),
            hitCost: `${view.hit_points ? `-${view.hit_points}` : "0"} pts`,
            hitNegative: view.hit_points > 0,
            total: shown.total,
            roll,
          }}
          chips={<ChipsBar view={view} editable={editable} announce={announceTeam} onChange={(next) => applyDirect({ view: next, rows: server.current?.rows ?? null })} />}
        >
          {!phone && (
            <div class="chips-block">
              <span class="label">League table</span>
              {leagueBlock}
            </div>
          )}
        </Rail>
      </div>
    </main>
  );
}
