import { CircleDot, GripVertical, Lock, PackageCheck } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { BoardRelease, Me, Release, ReleaseOrder, Roadmap } from "../../shared/api.js";
import { FEATURE_STATUS_LABELS, releaseIsLocked, releaseTransition, type FeatureStatus } from "../../shared/lifecycles.js";
import { api, isFailure, type ApiFailure } from "../api.js";
import { EmptyRelease } from "../art.js";
import { useFeedback } from "../feedback.js";
import { calendarDate } from "../format.js";
import { MEDIUM, prefersReducedMotion, SETTLE } from "../motion.js";
import { Dialog } from "../ui/Dialog.js";

const UNSCHEDULED = "unscheduled";
interface Card { id: string; name: string; status: FeatureStatus }
interface List { id: string; name: string; release: BoardRelease | null; cards: Card[] }
interface Spot { listId: string; index: number }
interface Move { card: Card; origin: Spot; at: Spot }

function listsOf(roadmap: Roadmap): List[] {
  return [
    { id: UNSCHEDULED, name: "Unscheduled", release: null, cards: roadmap.unscheduled },
    ...roadmap.columns.flatMap((c) => c.releases.map((r) => ({ id: r.id, name: r.name, release: r, cards: r.features }))),
  ];
}

/** The lists as the user sees them while a card is carried to `move.at`. */
function arranged(lists: List[], move: Move | null): List[] {
  if (!move) return lists;
  return lists.map((list) => {
    const cards = list.cards.filter((c) => c.id !== move.card.id);
    if (list.id === move.at.listId) cards.splice(Math.min(move.at.index, cards.length), 0, move.card);
    return { ...list, cards };
  });
}

const STATUS_ICON = { open: CircleDot, frozen: Lock, shipped: PackageCheck };
const STATUS_WORD = { open: "Open", frozen: "Frozen", shipped: "Shipped" };

export function RoadmapPage({ me }: { me: Me }) {
  const feedback = useFeedback();
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const [shipping, setShipping] = useState<Release | null>(null);
  const [busyRelease, setBusyRelease] = useState<string | null>(null);
  const board = useRef<HTMLElement>(null);
  const tops = useRef(new Map<string, DOMRect>());
  /** The card that keeps focus while it is carried and after it lands, until the user moves focus elsewhere. */
  const keepFocus = useRef<string | null>(null);
  /** Set when a move lands or is cancelled, so only that render slides cards; reloads and freezes jump. */
  const landing = useRef(false);
  const isHead = me.user.role === "head_of_product";

  const load = useCallback(async (): Promise<void> => {
    try {
      setRoadmap(await api.get<Roadmap>("/api/roadmap"));
    } catch (error) {
      feedback.fail(error);
    }
  }, [feedback]);
  useEffect(() => { void load(); }, [load]);

  const baseLists = roadmap ? listsOf(roadmap) : [];
  const lists = arranged(baseLists, move);
  const listById = (id: string): List | undefined => lists.find((l) => l.id === id);

  // Focus stays on the moved card, and cards slide into their new slots (medium tempo) while a move is under way or lands.
  useLayoutEffect(() => {
    const root = board.current;
    if (!root) return;
    const slide = (move !== null || landing.current) && pointer === null && !prefersReducedMotion();
    landing.current = false;
    const next = new Map<string, DOMRect>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-card]")) {
      const id = el.dataset.card ?? "";
      const rect = el.getBoundingClientRect();
      const before = tops.current.get(id);
      if (before && slide && (Math.abs(before.top - rect.top) > 1 || Math.abs(before.left - rect.left) > 1)) {
        el.animate([{ transform: `translate(${before.left - rect.left}px, ${before.top - rect.top}px)` }, { transform: "translate(0, 0)" }], { duration: MEDIUM, easing: SETTLE });
      }
      next.set(id, rect);
    }
    tops.current = next;
    const keep = keepFocus.current;
    const card = keep ? root.querySelector<HTMLElement>(`[data-card="${CSS.escape(keep)}"]`) : null;
    if (card && document.activeElement !== card) card.focus();
  });

  const failureCopy = (cardName: string, targetName: string) => (f: ApiFailure): string | null => {
    if (f.code === "order_conflict") return `The board changed while you were moving ${cardName}. It now shows the latest order.`;
    if (f.code === "feature_not_planned") return `${cardName} must be planned before it joins a release.`;
    if (f.code === "forbidden") return `${targetName} is frozen. Ask a head of product to change its scope.`;
    if (f.code === "release_shipped") return `${targetName} has shipped and can't change.`;
    if (f.code === "storage_unavailable") return `Storage is unavailable, so ${targetName} was not frozen. Try again in a minute.`;
    return null;
  };

  const commit = async (current: Move): Promise<void> => {
    const from = baseLists.find((l) => l.id === current.origin.listId);
    const to = baseLists.find((l) => l.id === current.at.listId);
    const touched = [from, to].filter((l): l is List => l !== undefined && l.release !== null);
    const target = to?.release ?? null;
    const frozenName = (to?.release && to.release.status !== "open" ? to.name : from?.release && from.release.status !== "open" ? from.name : to?.name) ?? "";
    feedback.clearAlert();
    feedback.say("save", "Saving order…");
    keepFocus.current = current.card.id;
    try {
      await api.post<{ releases: ReleaseOrder[] }>("/api/roadmap/moves", {
        featureId: current.card.id,
        toReleaseId: target?.id ?? null,
        toIndex: current.at.index,
        expectedOrderVersions: Object.fromEntries(touched.map((l) => [l.id, l.release?.orderVersion ?? 0])),
      });
      const fresh = await api.get<Roadmap>("/api/roadmap");
      landing.current = true;
      setMove(null);
      setRoadmap(fresh);
      const landed = listsOf(fresh).find((l) => l.id === current.at.listId);
      const index = landed?.cards.findIndex((c) => c.id === current.card.id) ?? -1;
      feedback.say("save", "Order saved.");
      feedback.say("board", `Dropped ${current.card.name}. Position ${index + 1} of ${landed?.cards.length ?? 0} in ${landed?.name ?? ""}.`);
    } catch (error) {
      landing.current = true;
      setMove(null);
      feedback.fail(error, failureCopy(current.card.name, frozenName));
      await load();
    }
  };

  const pickUp = (card: Card, listId: string): void => {
    const list = listById(listId);
    const index = list?.cards.findIndex((c) => c.id === card.id) ?? 0;
    const spot = { listId, index };
    setMove({ card, origin: spot, at: spot });
    keepFocus.current = card.id;
    feedback.say("board", `Picked up ${card.name}. Position ${index + 1} of ${list?.cards.length ?? 0} in ${list?.name ?? ""}.`);
  };

  const step = (current: Move, at: Spot): void => {
    const next = { ...current, at };
    setMove(next);
    const shown = arranged(baseLists, next).find((l) => l.id === at.listId);
    const i = shown?.cards.findIndex((c) => c.id === current.card.id) ?? 0;
    feedback.say("board", `${current.card.name}, position ${i + 1} of ${shown?.cards.length ?? 0} in ${shown?.name ?? ""}.`);
  };

  const onCardKey = (event: KeyboardEvent<HTMLButtonElement>, card: Card, listId: string): void => {
    const carrying = move?.card.id === card.id ? move : null;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (carrying) void commit(carrying);
      else if (!move) pickUp(card, listId);
      return;
    }
    if (!carrying) return;
    const order = lists.filter((l) => !l.release || !releaseIsLocked(l.release.status));
    const here = order.findIndex((l) => l.id === carrying.at.listId);
    const list = order[here];
    const index = list?.cards.findIndex((c) => c.id === card.id) ?? 0;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const length = list?.cards.length ?? 1;
      step(carrying, { listId: carrying.at.listId, index: Math.max(0, Math.min(length - 1, index + (event.key === "ArrowUp" ? -1 : 1))) });
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const neighbour = order[here + (event.key === "ArrowLeft" ? -1 : 1)];
      if (neighbour) step(carrying, { listId: neighbour.id, index: Math.min(index, neighbour.cards.length) });
    } else if (event.key === "Escape") {
      event.preventDefault();
      landing.current = true;
      setMove(null);
      const original = baseLists.find((l) => l.id === carrying.origin.listId);
      feedback.say("board", `Move cancelled. ${card.name} is back at position ${carrying.origin.index + 1} of ${original?.cards.length ?? 0} in ${original?.name ?? ""}.`);
    }
  };

  const onCardPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, card: Card, listId: string): void => {
    if (event.button !== 0 || move) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = event.currentTarget.getBoundingClientRect();
    let carrying: Move | null = null;
    const slotAt = (x: number, y: number): Spot | null => {
      const listEl = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-list]");
      const id = listEl?.dataset.list;
      if (!listEl || !id) return null;
      const cards = Array.from(listEl.querySelectorAll<HTMLElement>("[data-card]")).filter((el) => el.dataset.card !== card.id);
      const index = cards.findIndex((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
      return { listId: id, index: index < 0 ? cards.length : index };
    };
    const onMove = (e: PointerEvent): void => {
      if (!carrying && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
      if (!carrying) {
        const list = listById(listId);
        const spot = { listId, index: list?.cards.findIndex((c) => c.id === card.id) ?? 0 };
        carrying = { card, origin: spot, at: spot };
      }
      const at = slotAt(e.clientX, e.clientY) ?? carrying.at;
      carrying = { ...carrying, at };
      setMove(carrying);
      setPointer({ x: e.clientX, y: e.clientY, dx: startX - rect.left, dy: startY - rect.top });
    };
    const onUp = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPointer(null);
      if (!carrying) return;
      const at = slotAt(e.clientX, e.clientY) ?? carrying.at;
      const final = { ...carrying, at };
      if (final.at.listId === final.origin.listId && final.at.index === final.origin.index) setMove(null);
      else void commit(final);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const freeze = async (release: BoardRelease): Promise<void> => {
    setBusyRelease(release.id);
    feedback.clearAlert();
    try {
      await api.post(`/api/releases/${release.id}/freeze`);
      await load();
      feedback.say("save", `Scope frozen for ${release.name}.`);
    } catch (error) {
      feedback.fail(error, (f) => (f.code === "storage_unavailable" ? `Storage is unavailable, so ${release.name} was not frozen. Try again in a minute.` : null));
    } finally {
      setBusyRelease(null);
    }
  };

  if (!roadmap) return <div className="page-body" aria-busy="true" />;
  const grouped = roadmap.columns;

  const renderList = (list: List) => (
    <ul aria-label={list.name} className="card-list" data-list={list.id}>
      {list.cards.length === 0 && (
        <li className="card-empty">{list.release ? <><EmptyRelease /><span>Drag planned features here.</span></> : <span>Every planned feature has a release.</span>}</li>
      )}
      {list.cards.map((card) => {
        const lifted = move?.card.id === card.id;
        return (
          <li key={card.id} className={`card-slot ${lifted ? "card-slot-target" : ""}`}>
            <button
              type="button"
              data-card={card.id}
              aria-describedby={`card-status-${card.id}${lifted ? " board-help" : ""}`}
              className={`card ${lifted ? "card-lifted" : ""}`}
              style={lifted && pointer ? { position: "fixed", left: pointer.x - pointer.dx, top: pointer.y - pointer.dy, pointerEvents: "none", zIndex: 20, width: 240 } : undefined}
              onKeyDown={(e) => onCardKey(e, card, list.id)}
              onBlur={(e) => { if (e.relatedTarget !== null && keepFocus.current === card.id) keepFocus.current = null; }}
              onPointerDown={(e) => onCardPointerDown(e, card, list.id)}
            >
              <GripVertical aria-hidden="true" size={16} className="card-grip" />
              <span className="card-name">{card.name}</span>
              <span id={`card-status-${card.id}`} aria-hidden="true" className="card-status">{FEATURE_STATUS_LABELS[card.status]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="page-body roadmap-page">
      <header className="page-head">
        <h1>Roadmap</h1>
        <p id="board-help" className="hint">Pick up a card with Space or Enter, move it with the arrow keys, drop it with Space or Enter, or press Escape to put it back.</p>
      </header>
      <section aria-label="Roadmap board" className="board" ref={board}>
        <div className="lane">
          <h2 className="lane-title">Unscheduled</h2>
          {renderList(lists[0] ?? { id: UNSCHEDULED, name: "Unscheduled", release: null, cards: [] })}
        </div>
        {grouped.map((column) => (
          <section key={column.month} role="group" aria-label={column.label} className="month">
            <h2 className="month-title">{column.label}</h2>
            {column.releases.map((release) => {
              const list = listById(release.id) ?? { id: release.id, name: release.name, release, cards: [] };
              const Icon = STATUS_ICON[release.status];
              return (
                <article key={release.id} className={`release release-${release.status}`}>
                  <header className="release-head">
                    <h3 className="release-name">{release.name}</h3>
                    <p className="release-meta">
                      <span className="num">{calendarDate(release.targetDate)}</span>
                      <span className="release-status"><Icon aria-hidden="true" size={14} />{STATUS_WORD[release.status]}</span>
                      <span className="tag">{release.isPublic ? "Public" : "Internal"}</span>
                    </p>
                    {release.status === "shipped" && <p className="release-mail num">{release.emails.sent} of {release.emails.queued} customer emails sent</p>}
                  </header>
                  {renderList(list)}
                  {isHead && !releaseIsLocked(release.status) && (
                    <div className="release-actions">
                      {releaseTransition(release.status, "freeze") !== null && (
                        <button type="button" className="button-quiet" aria-busy={busyRelease === release.id} onClick={() => void freeze(release)}>
                          {busyRelease === release.id ? "Freezing scope…" : "Freeze scope"}
                        </button>
                      )}
                      {releaseTransition(release.status, "ship") !== null && <button type="button" className="button" onClick={() => setShipping(release)}>Ship release</button>}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </section>
      {shipping && <ShipDialog release={shipping} onClosed={() => setShipping(null)} onShipped={load} />}
    </div>
  );
}

function ShipDialog({ release, onClosed, onShipped }: { release: Release; onClosed: () => void; onShipped: () => Promise<void> }) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const ship = async (close: () => void): Promise<void> => {
    setBusy(true);
    feedback.clearAlert();
    try {
      const result = await api.post<{ release: Release; emailsQueued: number }>(`/api/releases/${release.id}/ship`, undefined, { "Idempotency-Key": key.current });
      feedback.say("save", `${release.name} shipped. ${result.emailsQueued} customer emails queued for delivery.`);
      await onShipped();
      close();
    } catch (error) {
      feedback.fail(error, (f) => (f.code === "invalid_transition" ? `Freeze ${release.name} before shipping it.` : isFailure(f, 409) ? `${release.name} has shipped and can't change.` : null));
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Ship ${release.name}`} onClosed={onClosed}>
      {(close) => (
        <div className="dialog-body">
          <p>Each customer who asked for these features gets one email.</p>
          <div className="dialog-actions">
            <button type="button" className="button-quiet" onClick={close}>Cancel</button>
            <button type="button" className="button" aria-busy={busy} disabled={busy} onClick={() => void ship(close)}>{busy ? "Shipping…" : "Ship and notify customers"}</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
