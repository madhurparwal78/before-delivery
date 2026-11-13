import { useEffect, useRef, useState } from "preact/hooks";
import { POSITIONS, type CataloguePlayer, type Club, type DraftView, type Position, type SquadPlayer, type SquadView, type TransferConfirmation } from "../../shared/api.ts";
import { messagesOf, request } from "../api.ts";
import { useAnnouncer } from "../announce.ts";
import { Board, pitchRows, type BoardItem, type BoardRow } from "../components/Board.tsx";
import { ChipsBar } from "../components/Chips.tsx";
import { Modal } from "../components/Dialog.tsx";
import { PlayerList } from "../components/PlayerList.tsx";
import { LockedBanner, Rail, ViewSwitch } from "../components/Rail.tsx";
import type { ShirtData } from "../components/Shirt.tsx";
import { deadlineCopy, millions, money, POSITION_PLURAL, POSITION_WORD } from "../format.ts";
import { useLive } from "../live.ts";
import { PHONE, useMedia } from "../media.ts";
import { navigate, useLocation } from "../router.ts";
import { useApp } from "../store.ts";

// Transfers: the squad pitch, the server draft, the filters and the Players list; the squad builder
// when there is no squad yet (brief: Screens / Transfers, Interactions / Transfers).

// The builder shows fifteen empty outlines and the money left from the 100.0m budget (brief: Screens / Transfers);
// the server decides whether the squad is legal when it is confirmed.
const BUILDER_SLOTS: Position[] = ["GK", "GK", "DEF", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "MID", "FWD", "FWD", "FWD"];
const BUDGET_TENTHS = 1000;
const PRICE_CAPS = Array.from({ length: 15 }, (_, i) => millions(40 + i * 5));
const SORTS = [
  { value: "price_desc", label: "Highest price" },
  { value: "price_asc", label: "Lowest price" },
  { value: "points_desc", label: "Most points" },
  { value: "name_asc", label: "Name" },
];
const FILTER_KEYS = ["position", "club", "max_price", "sort", "view"] as const;

// "Transfers <count> · Free used <free> · Hit -<hit> pts · Bank <bank>m" (brief: Public screens).
function previewText(draft: DraftView) {
  const preview = draft.preview;
  return (
    <>
      <span>Transfers {preview.count}</span> · <span>Free used {preview.free_transfers_used}</span> · <span>Hit -{preview.hit_points} pts</span> ·{" "}
      <span>Bank {millions(preview.bank_after_tenths)}m</span>
    </>
  );
}

export function TransfersPage() {
  const app = useApp();
  const { search } = useLocation();
  const phone = useMedia(PHONE);
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, search.get(key) ?? ""])) as Record<(typeof FILTER_KEYS)[number], string>;
  const viewMode = filters.view === "list" ? "list" : "pitch";
  const listQuery = new URLSearchParams(Object.entries(filters).filter(([key, value]) => key !== "view" && value)).toString();

  const [view, setView] = useState<SquadView | null>(null);
  const [noSquad, setNoSquad] = useState(false);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [local, setLocal] = useState<{ outs: string[]; ins: string[] }>({ outs: [], ins: [] });
  const [clubs, setClubs] = useState<Club[]>([]);
  const [players, setPlayers] = useState<CataloguePlayer[] | null>(null);
  const [catalogue, setCatalogue] = useState<Map<string, CataloguePlayer>>(new Map());
  const [picks, setPicks] = useState<(string | null)[]>(BUILDER_SLOTS.map(() => null));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ key: string; hit: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [updates, announce] = useAnnouncer();
  const saves = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const localRef = useRef(local);
  localRef.current = local;

  const status = app.gameweek?.status ?? "open";
  const number = app.gameweek?.number ?? view?.gameweek ?? 1;
  const editable = status === "open" && (noSquad || view?.editable === true);

  const loadSquad = async () => {
    const [squad, current] = await Promise.all([request<SquadView>("GET", "/api/squad"), request<DraftView>("GET", "/api/transfers/draft")]);
    if (squad.ok) {
      setView(squad.data);
      setNoSquad(false);
    } else if (squad.error.error === "no_squad") {
      setNoSquad(true);
    }
    if (current.ok && pendingSaves.current === 0) {
      setDraft(current.data);
      setLocal({ outs: current.data.out, ins: current.data.in });
    }
  };

  const loadCatalogue = async () => {
    const all = await request<{ players: CataloguePlayer[] }>("GET", "/api/players");
    if (all.ok) setCatalogue(new Map(all.data.players.map((player) => [player.id, player])));
  };

  useEffect(() => {
    void loadSquad();
    void loadCatalogue();
    void request<{ clubs: Club[] }>("GET", "/api/clubs").then((result) => result.ok && setClubs(result.data.clubs));
  }, []);

  const loadList = async (query: string) => {
    const result = await request<{ players: CataloguePlayer[] }>("GET", `/api/players${query ? `?${query}` : ""}`);
    if (result.ok && listQueryRef.current === query) setPlayers(result.data.players);
  };
  const listQueryRef = useRef(listQuery);
  listQueryRef.current = listQuery;
  useEffect(() => {
    void loadList(listQuery);
  }, [listQuery]);

  useLive((message) => {
    if (message.t === "gameweek" || message.t === "squad") void loadSquad();
    if (message.t === "prices" || message.t === "gameweek") {
      void loadSquad();
      void loadCatalogue();
      void loadList(listQueryRef.current);
    }
  });

  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string) => {
    const next = new URLSearchParams(location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    navigate(`/transfers${query ? `?${query}` : ""}`);
  };

  // Every change to the draft is saved on the server, which answers with the preview.
  const saveDraft = (outs: string[], ins: string[]) => {
    setLocal({ outs, ins });
    pendingSaves.current += 1;
    const gameweek = view!.gameweek;
    saves.current = saves.current.then(async () => {
      const result = await request<DraftView>("PUT", "/api/transfers/draft", { gameweek, out: outs, in: ins });
      pendingSaves.current -= 1;
      if (result.ok) {
        setDraft(result.data);
        if (pendingSaves.current === 0) setLocal({ outs: result.data.out, ins: result.data.in });
      } else if (result.error.error === "gameweek_locked" || result.error.error === "gameweek_not_open") {
        announce(deadlineCopy(gameweek), true);
      } else {
        announce(result.error.message, true);
      }
    });
  };

  const squadPlayers = view?.players ?? [];
  const owned = new Set(squadPlayers.map((player) => player.id));
  const byId = (id: string) => squadPlayers.find((player) => player.id === id);

  const toggleOut = (id: string) => {
    if (!editable) return;
    const { outs, ins } = localRef.current;
    const index = outs.indexOf(id);
    if (index < 0) {
      saveDraft([...outs, id], ins);
    } else {
      saveDraft(
        outs.filter((out) => out !== id),
        ins.filter((_, i) => i !== index),
      );
    }
  };

  const unmarkLatest = () => {
    if (!editable) return;
    const { outs, ins } = localRef.current;
    if (outs.length > ins.length) saveDraft(outs.slice(0, -1), ins);
  };

  const bringIn = (player: CataloguePlayer) => {
    if (!editable) return;
    if (noSquad) {
      if (picks.includes(player.id)) {
        announce(`${player.name} is already in your squad.`, true);
        return;
      }
      const slot = BUILDER_SLOTS.findIndex((position, i) => position === player.position && picks[i] === null);
      if (slot < 0) {
        announce(`No empty ${POSITION_WORD[player.position]} slot. Empty a ${POSITION_WORD[player.position]} shirt first.`, true);
        return;
      }
      setPicks(picks.map((id, i) => (i === slot ? player.id : id)));
      return;
    }
    const { outs, ins } = localRef.current;
    if (owned.has(player.id) || ins.includes(player.id)) {
      announce(`${player.name} is already in your squad.`, true);
      return;
    }
    // A player comes in for the earliest unpaired out of the same position (brief: Interactions / Transfers).
    const unpaired = outs.slice(ins.length);
    const slot = unpaired.find((id) => byId(id)?.position === player.position);
    if (!slot) {
      announce(`Mark a ${POSITION_WORD[player.position]} to sell first.`, true);
      return;
    }
    const reordered = [...outs.slice(0, ins.length), slot, ...unpaired.filter((id) => id !== slot)];
    saveDraft(reordered, [...ins, player.id]);
  };

  const focusPitch = () => document.querySelector<HTMLElement>('[aria-label="Pitch"] [data-nav][tabindex="0"]')?.focus();

  const resetDraft = async () => {
    setBusy("reset");
    pendingSaves.current += 1;
    await saves.current;
    const result = await request<DraftView>("DELETE", "/api/transfers/draft");
    pendingSaves.current -= 1;
    setBusy(null);
    if (result.ok) {
      setDraft(result.data);
      setLocal({ outs: [], ins: [] });
    }
  };

  const confirmTransfers = async () => {
    if (!confirming || !view) return;
    setBusy("confirm");
    await saves.current;
    let result: Awaited<ReturnType<typeof request<TransferConfirmation>>> | null = null;
    for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
      try {
        result = await request<TransferConfirmation>(
          "POST",
          "/api/transfers",
          { gameweek: view.gameweek, out: local.outs.slice(0, local.ins.length), in: local.ins, hit_points: confirming.hit },
          { "Idempotency-Key": confirming.key },
        );
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    setBusy(null);
    setConfirming(null);
    if (!result) {
      announce("The connection dropped before the confirmation arrived. Review the transfers and confirm again.", true);
    } else if (result.ok) {
      const done = result.data;
      announce(`Transfers confirmed: ${done.transfers.length} made, hit ${done.hit_points} points, bank ${millions(done.bank_tenths)}m.`);
    } else if (result.error.error === "gameweek_locked" || result.error.error === "gameweek_not_open") {
      announce(deadlineCopy(view.gameweek), true);
    } else if (result.error.error === "hit_changed") {
      announce(`The hit is now ${result.error.hit_points ?? 0} points. Check it and confirm again.`, true);
    } else if (result.error.error === "rules_broken") {
      announce(`Transfers refused: ${messagesOf(result.error)}.`, true);
    } else {
      announce(result.error.message, true);
    }
    await loadSquad();
  };

  const confirmSquad = async () => {
    setBusy("squad");
    const result = await request<SquadView>("POST", "/api/squad", { players: picks.filter((id): id is string => id !== null) });
    setBusy(null);
    if (result.ok) {
      announce(`Squad confirmed. Bank ${millions(result.data.bank_tenths)}m.`);
      navigate("/team");
    } else if (result.error.error === "gameweek_locked" || result.error.error === "gameweek_not_open") {
      announce(deadlineCopy(number), true);
    } else if (result.error.error === "rules_broken") {
      announce(`Squad refused: ${messagesOf(result.error)}.`, true);
    } else {
      announce(result.error.message, true);
    }
  };

  // The board: the squad with Out tags and incoming players, or fifteen slots for the builder.
  let rows: BoardRow[];
  let homeKey: string;
  if (noSquad) {
    const items = picks.map((id, index): BoardItem => {
      const player = id ? catalogue.get(id) : undefined;
      return player
        ? {
            kind: "shirt",
            shirt: { id: player.id, name: player.name, club: player.club, position: player.position, points: 0, figure: millions(player.price_tenths), captain: false, vice: false },
          }
        : { kind: "slot", slot: { key: `slot-${index}`, position: BUILDER_SLOTS[index]! } };
    });
    const ofPosition = (position: Position) => items.filter((_, i) => BUILDER_SLOTS[i] === position);
    rows = (["FWD", "MID", "DEF", "GK"] as const).map((position) => ({ key: position, items: ofPosition(position) }));
    homeKey = picks[0] ?? "slot-0";
  } else {
    const shirtOf = (player: SquadPlayer): ShirtData => {
      const index = local.outs.indexOf(player.id);
      const incoming = index >= 0 && index < local.ins.length ? catalogue.get(local.ins[index]!)?.name ?? null : null;
      return {
        id: player.id,
        name: player.name,
        club: player.club,
        position: player.position,
        points: player.team_points,
        figure: millions(index >= 0 ? player.selling_price_tenths : player.price_tenths),
        captain: player.captain,
        vice: player.vice_captain,
        out: index >= 0,
        incoming,
      };
    };
    const layout = pitchRows(
      squadPlayers.filter((p) => p.slot === "starting"),
      squadPlayers.filter((p) => p.slot === "bench"),
    );
    rows = [
      ...layout.field.map((group, index) => ({ key: `row-${index}`, items: group.map((p): BoardItem => ({ kind: "shirt", shirt: shirtOf(p) })) })),
      { key: "bench", bench: true, items: layout.bench.map((p): BoardItem => ({ kind: "shirt", shirt: shirtOf(p) })) },
    ];
    homeKey = squadPlayers.find((p) => p.slot === "starting" && p.position === "GK")?.id ?? "";
  }

  const spent = picks.reduce((sum, id) => sum + (id ? catalogue.get(id)?.price_tenths ?? 0 : 0), 0);
  const pairs = local.ins.map((id, index) => ({ out: byId(local.outs[index]!)?.name ?? "", in: catalogue.get(id)?.name ?? id }));
  const loaded = (noSquad || view) && clubs.length > 0 && players !== null;

  if (!loaded) {
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
        <h1>{noSquad ? "Build your squad" : "Transfers"}</h1>
        <ViewSwitch view={viewMode} onChange={(mode) => setFilter("view", mode)} />
      </div>
      <div class="board">
        <div class="board-main">
          <p class={`updates result-strip${updates.error ? " is-error" : ""}`} role="status" aria-label="Team updates">
            {updates.text}
          </p>
          <Board
            view={viewMode}
            rows={rows}
            homeKey={homeKey}
            focusKey={focusKey}
            onFocusKey={setFocusKey}
            selected={null}
            selectable={editable && !noSquad}
            pressedOf={(id) => local.outs.includes(id)}
            pendingKey={null}
            badges={{}}
            builder={noSquad}
            onActivate={(key) => {
              if (noSquad) {
                if (editable) setPicks(picks.map((id) => (id === key ? null : id)));
              } else {
                toggleOut(key);
              }
            }}
            onEscape={unmarkLatest}
            actions={
              <p class="hint">
                {!editable
                  ? "Transfers are closed until the next gameweek opens."
                  : noSquad
                    ? "Pick fifteen players from the list: 2 goalkeepers, 5 defenders, 5 midfielders and 3 forwards."
                    : "Choose shirts to sell, then bring in players of the same position from the list."}
              </p>
            }
          />
          <div class="draft-bar panel">
            <p class="preview" role="status" aria-label="Draft preview">
              {noSquad ? `Squad ${picks.filter(Boolean).length} of 15 · Bank ${millions(BUDGET_TENTHS - spent)}m` : draft ? previewText(draft) : ""}
            </p>
            {noSquad ? (
              <button type="button" class="btn btn-primary" disabled={!editable || busy === "squad"} onClick={() => void confirmSquad()}>
                {busy === "squad" ? "Confirming…" : "Confirm squad"}
              </button>
            ) : (
              <div class="draft-actions">
                <button type="button" class="btn" disabled={!editable || busy === "reset" || local.outs.length === 0} onClick={() => void resetDraft()}>
                  {busy === "reset" ? "Resetting…" : "Reset draft"}
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  id="review-transfers"
                  disabled={!editable || local.ins.length === 0}
                  onClick={() => setConfirming({ key: crypto.randomUUID(), hit: draft?.preview.hit_points ?? 0 })}
                >
                  Review transfers
                </button>
              </div>
            )}
          </div>
          <div class="filters">
            <div class="field">
              <label for="filter-position">Position</label>
              <select id="filter-position" class="input" value={filters.position} onChange={(e) => setFilter("position", e.currentTarget.value)}>
                <option value="">All</option>
                {POSITIONS.map((position) => (
                  <option value={position}>{POSITION_PLURAL[position]}</option>
                ))}
              </select>
            </div>
            <div class="field">
              <label for="filter-club">Club</label>
              <select id="filter-club" class="input" value={filters.club} onChange={(e) => setFilter("club", e.currentTarget.value)}>
                <option value="">All clubs</option>
                {clubs.map((club) => (
                  <option value={club.code}>{club.name}</option>
                ))}
              </select>
            </div>
            <div class="field">
              <label for="filter-price">Max price</label>
              <select id="filter-price" class="input" value={filters.max_price} onChange={(e) => setFilter("max_price", e.currentTarget.value)}>
                <option value="">Any</option>
                {PRICE_CAPS.map((cap) => (
                  <option value={cap}>{cap}m</option>
                ))}
              </select>
            </div>
            <div class="field">
              <label for="filter-sort">Sort</label>
              <select id="filter-sort" class="input" value={filters.sort || "price_desc"} onChange={(e) => setFilter("sort", e.currentTarget.value === "price_desc" ? "" : e.currentTarget.value)}>
                {SORTS.map((sort) => (
                  <option value={sort.value}>{sort.label}</option>
                ))}
              </select>
            </div>
          </div>
          <PlayerList players={players ?? []} owned={noSquad ? new Set(picks.filter((id): id is string => id !== null)) : owned} onPick={bringIn} onEscape={focusPitch} />
        </div>
        {(view || noSquad) && (
          <Rail
            phone={phone}
            figures={
              view
                ? {
                    bank: money(view.bank_tenths),
                    squadValue: money(view.squad_value_tenths),
                    freeTransfers: String(view.free_transfers),
                    hitCost: `${view.hit_points ? `-${view.hit_points}` : "0"} pts`,
                    hitNegative: view.hit_points > 0,
                    total: view.gameweek_total,
                    roll: 0,
                  }
                : { bank: money(BUDGET_TENTHS - spent), squadValue: money(spent), freeTransfers: "1", hitCost: "0 pts", hitNegative: false, total: 0, roll: 0 }
            }
            chips={view ? <ChipsBar view={view} editable={editable} announce={announce} onChange={setView} /> : null}
          />
        )}
      </div>
      {confirming && view && (
        <Modal title="Confirm transfers" initialFocus="[data-keep-editing]" returnTo={() => document.getElementById("review-transfers")} onClose={() => setConfirming(null)}>
          {(close) => (
            <>
              <ul class="pair-list">
                {pairs.map((pair) => (
                  <li key={pair.in}>
                    {pair.out} → {pair.in}
                  </li>
                ))}
              </ul>
              <p class="mono">
                Hit -{confirming.hit} pts · Bank afterwards {draft ? money(draft.preview.bank_after_tenths) : ""}
              </p>
              <div class="dialog-actions">
                <button type="button" class="btn" data-keep-editing onClick={close}>
                  Keep editing
                </button>
                <button type="button" class="btn btn-primary" disabled={busy === "confirm"} onClick={() => void confirmTransfers()}>
                  {busy === "confirm" ? "Confirming…" : "Confirm transfers"}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </main>
  );
}
