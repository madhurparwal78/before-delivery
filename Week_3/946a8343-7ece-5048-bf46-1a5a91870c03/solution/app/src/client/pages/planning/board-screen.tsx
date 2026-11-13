// The board screen shared by project and group boards: filters, the lists side by side, the cards and every way to move one
// (keyboard lift, mouse drag, touch hold). Moves are optimistic: they are laid over the loaded lists at once and taken off when
// the server answers; a refusal shows its message and the server's lists.
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { announce } from "../../announce.tsx";
import { api, asApiError, type Resource } from "../../api.ts";
import { prefersReducedMotion } from "../../hooks.ts";
import { A, navigate, setQuery, useQuery } from "../../router.ts";
import { Notice, Skeleton } from "../../ui/feedback.tsx";
import { Select, TextField } from "../../ui/fields.tsx";
import { ScopedLabel } from "../../ui/chip.tsx";
import {
  afterIdAt, applyOutcome, applyPending, cardKey, cardLabel, findCard, issueCountText, withLift,
  type Lift, type PendingMove,
} from "./board-model.ts";
import { cardFacts, optionList, type FilterOptions } from "./filters.ts";
import { readMoveOutcome, type BoardCard, type BoardData, type BoardList } from "./types.ts";

interface BoardScreenProps {
  resource: Resource<BoardData>;
  boardId: number;
  /** Project the issues of this board belong to when it is a project board (links on cards), null on a group board. */
  projectId: string | null;
  options: FilterOptions;
  canMove: boolean;
}

interface Press {
  kind: "mouse" | "touch";
  issue: number;
  listId: number;
  x: number;
  y: number;
  active: boolean;
  timer: number | null;
}

interface Drag {
  issue: number;
  listId: number;
  dx: number;
  dy: number;
  overListId: number | null;
}

const HOLD_MS = 200;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const SETTLE_MS = 200;
const SETTLE_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function referenceOf(card: BoardCard): string {
  return card.project === null ? `Issue #${card.iid}` : `Issue ${card.project}#${card.iid}`;
}

interface DropSpot {
  listId: number;
  index: number;
}

/** The list under a point and where among its cards (other than `issue`) the point falls. */
function spotAt(x: number, y: number, issue: number): DropSpot | null {
  for (const element of document.elementsFromPoint(x, y)) {
    if (!(element instanceof HTMLElement)) continue;
    const column = element.closest<HTMLElement>("[data-list-id]");
    if (column === null) continue;
    const listId = Number(column.dataset.listId);
    let index = 0;
    for (const card of column.querySelectorAll<HTMLElement>("[data-card]")) {
      if (Number(card.dataset.issue) === issue) continue;
      const box = card.getBoundingClientRect();
      if (y > box.top + box.height / 2) index++;
    }
    return { listId, index };
  }
  return null;
}

export function BoardScreen({ resource, boardId, projectId, options, canMove }: BoardScreenProps) {
  const query = useQuery();
  const data = resource.data;
  const root = useRef<HTMLElement>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const [pending, setPending] = useState<readonly PendingMove[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roving, setRoving] = useState<number | null>(null);
  const focusIssue = useRef<number | null>(null);
  const settle = useRef<string | null>(null);
  const typing = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const moveSeq = useRef(0);
  const clickGuard = useRef(false);

  const loaded = useMemo(() => (data ? applyPending(data.lists, pending) : []), [data, pending]);
  const lists = useMemo(() => withLift(loaded, lift), [loaded, lift]);

  const latest = useRef({ data, lists, loaded, canMove, lift, pending });
  latest.current = { data, lists, loaded, canMove, lift, pending };

  // A lifted card that disappears (another viewer moved or closed it) is let go.
  useLayoutEffect(() => {
    if (lift !== null && data && findCard(data.lists, lift.issue) === null) setLift(null);
  }, [data, lift]);

  // Focus follows the card through re-renders, and a dropped card settles.
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    const wanted = focusIssue.current;
    if (wanted !== null) {
      const card = element.querySelector<HTMLElement>(`[data-issue="${wanted}"][data-lifted="true"]`) ?? element.querySelector<HTMLElement>(`[data-issue="${wanted}"]`);
      if (card !== null && document.activeElement !== card) card.focus();
    }
    const key = settle.current;
    if (key !== null) {
      settle.current = null;
      const card = element.querySelector<HTMLElement>(`[data-card="${key}"]`);
      if (card !== null && !prefersReducedMotion()) {
        card.animate([{ transform: "scale(1.04)" }, { transform: "scale(1)" }], { duration: SETTLE_MS, easing: SETTLE_EASING, id: "card-settle" });
      }
    }
  });

  // Focus moved on purpose to something outside the cards: stop pulling it back.
  useLayoutEffect(() => {
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("[data-card]") === null) focusIssue.current = null;
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, []);

  function send(move: PendingMove): void {
    queue.current = queue.current.then(async () => {
      const current = latest.current.data;
      const card = current ? findCard(current.lists, move.issue)?.card : undefined;
      const inLists = current ? current.lists.filter((list) => list.cards.some((entry) => entry.issue === move.issue)).length : 0;
      const body: Record<string, number | null> = { issue: move.issue, to_list: move.toListId, after_id: move.afterId, version: card?.version ?? 0 };
      if (inLists > 1) body["from_list"] = move.fromListId;
      try {
        const outcome = readMoveOutcome(await api.post<unknown>(`/api/boards/${boardId}/moves`, body));
        const base = latest.current.data;
        if (base) resource.setData(() => ({ ...base, lists: applyOutcome(base.lists, outcome) }));
        setPending((moves) => moves.filter((entry) => entry.id !== move.id));
        for (const note of outcome.notes) if (!note.startsWith("Card moved:")) announce(note);
        void resource.reload();
      } catch (cause) {
        const failure = asApiError(cause);
        setPending((moves) => moves.filter((entry) => entry.id !== move.id));
        setNotice(failure.message);
        announce(failure.message, "error");
        await resource.reload();
      }
    });
  }

  function drop(issue: number, fromListId: number, toListId: number, afterId: number | null): void {
    setNotice(null);
    const move: PendingMove = { id: ++moveSeq.current, issue, fromListId, toListId, afterId };
    setPending((moves) => [...moves, move]);
    settle.current = cardKey(toListId, issue);
    send(move);
  }

  function release(issue: number, fromListId: number, spot: DropSpot | null): void {
    const target = spot === null ? undefined : latest.current.loaded.find((list) => list.id === spot.listId);
    setDrag(null);
    if (spot === null || target === undefined) return;
    const afterId = afterIdAt(target, issue, spot.index);
    const origin = latest.current.loaded.find((list) => list.id === fromListId);
    if (origin !== undefined && target.id === fromListId && origin.cards.findIndex((card) => card.issue === issue) === spot.index) return;
    drop(issue, fromListId, spot.listId, afterId);
  }

  function pressAt(event: { target: EventTarget | null }, x: number, y: number, kind: Press["kind"]): Press | null {
    if (!latest.current.canMove || !(event.target instanceof Element)) return null;
    const card = event.target.closest<HTMLElement>("[data-card]");
    if (card === null) return null;
    return { kind, issue: Number(card.dataset.issue), listId: Number(card.dataset.fromList), x, y, active: false, timer: null };
  }

  // Mouse drag and touch hold are native listeners: touchmove must be able to cancel scrolling.
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    let press: Press | null = null;

    const start = (target: Press) => {
      target.active = true;
      focusIssue.current = null;
      setNotice(null);
      setDrag({ issue: target.issue, listId: target.listId, dx: 0, dy: 0, overListId: target.listId });
    };
    const follow = (target: Press, x: number, y: number) => {
      const spot = spotAt(x, y, target.issue);
      setDrag({ issue: target.issue, listId: target.listId, dx: x - target.x, dy: y - target.y, overListId: spot?.listId ?? null });
    };
    const finish = (target: Press, x: number, y: number) => {
      release(target.issue, target.listId, spotAt(x, y, target.issue));
    };

    const onMouseDown = (event: MouseEvent) => {
      clickGuard.current = false;
      if (event.button !== 0) return;
      press = pressAt(event, event.clientX, event.clientY, "mouse");
      if (press === null) return;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };
    const onMouseMove = (event: MouseEvent) => {
      if (press === null) return;
      if (!press.active) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < MOUSE_SLOP) return;
        start(press);
      }
      event.preventDefault();
      follow(press, event.clientX, event.clientY);
    };
    const onMouseUp = (event: MouseEvent) => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      const done = press;
      press = null;
      if (done === null || !done.active) return;
      clickGuard.current = true;
      finish(done, event.clientX, event.clientY);
    };

    const clear = () => {
      if (press !== null && press.timer !== null) window.clearTimeout(press.timer);
      press = null;
    };
    const onTouchStart = (event: TouchEvent) => {
      clear();
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch === undefined) return;
      const next = pressAt(event, touch.clientX, touch.clientY, "touch");
      if (next === null) return;
      press = next;
      next.timer = window.setTimeout(() => {
        next.timer = null;
        if (press === next) start(next);
      }, HOLD_MS);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (press === null || touch === undefined) return;
      if (!press.active) {
        if (Math.hypot(touch.clientX - press.x, touch.clientY - press.y) >= TOUCH_SLOP) clear();
        return;
      }
      if (event.cancelable) event.preventDefault();
      const box = element.getBoundingClientRect();
      if (touch.clientX < box.left + 32) element.scrollLeft -= 24;
      else if (touch.clientX > box.right - 32) element.scrollLeft += 24;
      follow(press, touch.clientX, touch.clientY);
    };
    const onTouchEnd = (event: TouchEvent) => {
      const done = press;
      const touch = event.changedTouches[0];
      if (done !== null && done.timer !== null) window.clearTimeout(done.timer);
      press = null;
      if (done === null || !done.active || touch === undefined) return;
      if (event.cancelable) event.preventDefault();
      finish(done, touch.clientX, touch.clientY);
    };
    const onTouchCancel = () => {
      const done = press;
      clear();
      if (done !== null && done.active) setDrag(null);
    };
    const onClick = (event: MouseEvent) => {
      if (!clickGuard.current) return;
      clickGuard.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const onContextMenu = (event: Event) => {
      if (latest.current.canMove && event.target instanceof Element && event.target.closest("[data-card]") !== null) event.preventDefault();
    };

    element.addEventListener("mousedown", onMouseDown);
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", onTouchEnd, { passive: false });
    element.addEventListener("touchcancel", onTouchCancel);
    element.addEventListener("click", onClick, true);
    element.addEventListener("contextmenu", onContextMenu);
    return () => {
      clear();
      element.removeEventListener("mousedown", onMouseDown);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchCancel);
      element.removeEventListener("click", onClick, true);
      element.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [data === undefined]);

  function focusCard(listId: number, issue: number): void {
    const target = root.current?.querySelector<HTMLElement>(`[data-card="${cardKey(listId, issue)}"]`);
    target?.focus();
  }

  function onKeyDown(event: KeyboardEvent, list: BoardList, card: BoardCard, index: number): void {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    const moving = lift !== null && lift.issue === card.issue;
    const here = lists.findIndex((entry) => entry.id === list.id);
    if (!moving) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        const next = list.cards[index + (key === "ArrowDown" ? 1 : -1)];
        if (next !== undefined) focusCard(list.id, next.issue);
      } else if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        const step = key === "ArrowRight" ? 1 : -1;
        for (let at = here + step; at >= 0 && at < lists.length; at += step) {
          const neighbour = lists[at];
          const next = neighbour?.cards[Math.min(index, (neighbour?.cards.length ?? 1) - 1)];
          if (neighbour !== undefined && next !== undefined) {
            focusCard(neighbour.id, next.issue);
            break;
          }
        }
      } else if (key === " " && canMove) {
        event.preventDefault();
        setNotice(null);
        focusIssue.current = card.issue;
        setLift({ issue: card.issue, fromListId: list.id, listId: list.id, index });
        announce(`Lifted ${referenceOf(card)}.`);
      } else if (key === "Enter") {
        event.preventDefault();
        const project = projectId ?? (card.projectId === null ? null : String(card.projectId));
        if (project !== null) navigate(`/projects/${project}/-/issues/${card.iid}`);
      }
      return;
    }
    if (lift === null) return;
    const rest = (listId: number): number => (loaded.find((entry) => entry.id === listId)?.cards.filter((entry) => entry.issue !== lift.issue).length ?? 0);
    const over = (listId: number, to: number): void => {
      event.preventDefault();
      if (listId === lift.listId && to === lift.index) return;
      focusIssue.current = lift.issue;
      setLift({ ...lift, listId, index: to });
      const title = loaded.find((entry) => entry.id === listId)?.title ?? "";
      announce(`Over ${title}, position ${to + 1}.`);
    };
    if (key === "ArrowDown") over(lift.listId, Math.min(lift.index + 1, rest(lift.listId)));
    else if (key === "ArrowUp") over(lift.listId, Math.max(lift.index - 1, 0));
    else if (key === "ArrowLeft" || key === "ArrowRight") {
      const neighbour = lists[here + (key === "ArrowRight" ? 1 : -1)];
      if (neighbour === undefined) event.preventDefault();
      else over(neighbour.id, Math.min(lift.index, rest(neighbour.id)));
    } else if (key === " ") {
      event.preventDefault();
      const target = loaded.find((entry) => entry.id === lift.listId);
      if (target === undefined) return;
      const afterId = afterIdAt(target, lift.issue, lift.index);
      focusIssue.current = lift.issue;
      setLift(null);
      announce(`Dropped in ${target.title}, position ${lift.index + 1}.`);
      drop(lift.issue, lift.fromListId, lift.listId, afterId);
    } else if (key === "Escape") {
      event.preventDefault();
      focusIssue.current = lift.issue;
      setLift(null);
      announce("Move canceled.");
    }
  }

  const facts = cardFacts(data?.lists ?? []);
  const label = query.get("label");
  const assignee = query.get("assignee");
  const milestone = query.get("milestone");
  const filterOptions = (known: readonly string[], seen: readonly string[], current: string | null, any: string) => [
    { value: "", label: any },
    ...optionList(known, seen, current).map((name) => ({ value: name, label: name })),
  ];

  const firstIssue = lists.find((list) => list.cards.length > 0)?.cards[0]?.issue ?? null;
  const tabbable = roving !== null && findCard(lists, roving) !== null ? roving : firstIssue;
  const many = lists.length > 4;

  return (
    <>
      {notice !== null ? <Notice>{notice}</Notice> : null}
      {resource.error ? <Notice>{resource.error.message}</Notice> : null}
      <div class="sp-board-filters">
        <Select class="sp-board-filters__field" label="Filter by label" name="board-label" value={label ?? ""} options={filterOptions(options.labels, facts.labels, label, "All labels")} onChange={(event) => setQuery({ label: event.currentTarget.value })} />
        <Select class="sp-board-filters__field" label="Filter by assignee" name="board-assignee" value={assignee ?? ""} options={filterOptions(options.assignees, facts.assignees, assignee, "All assignees")} onChange={(event) => setQuery({ assignee: event.currentTarget.value })} />
        <Select class="sp-board-filters__field" label="Filter by milestone" name="board-milestone" value={milestone ?? ""} options={filterOptions(options.milestones, facts.milestones, milestone, "All milestones")} onChange={(event) => setQuery({ milestone: event.currentTarget.value })} />
        <TextField
          class="sp-board-filters__field"
          type="search"
          label="Filter cards"
          name="board-search"
          autoComplete="off"
          value={query.get("search") ?? ""}
          onInput={(event) => {
            setQuery({ search: event.currentTarget.value }, { replace: typing.current });
            typing.current = true;
          }}
          onBlur={() => {
            typing.current = false;
          }}
        />
      </div>
      {data ? (
        <section
          ref={root}
          role="region"
          aria-label={`Board ${data.name}`}
          tabIndex={0}
          class={`sp-board${many ? " sp-board--many" : ""}`}
          data-dragging={drag !== null ? "true" : undefined}
        >
          {lists.map((list) => (
            <div key={list.id} class="sp-board__column" data-list-id={list.id} data-over={drag !== null && drag.overListId === list.id ? "true" : undefined}>
              <h2 class="sp-board__title">{list.title}</h2>
              <div role="list" aria-label={list.title} class="sp-board__cards">
                <div class="sp-board__count">{issueCountText(list.cards.length)}</div>
                {list.cards.length === 0 ? (
                  <div role="listitem" class="sp-board__empty">
                    No cards
                  </div>
                ) : null}
                {list.cards.map((card, index) => {
                  const lifted = (lift !== null && lift.issue === card.issue && lift.listId === list.id) || (drag !== null && drag.issue === card.issue && drag.listId === list.id);
                  const dragged = drag !== null && drag.issue === card.issue && drag.listId === list.id;
                  const href = `/projects/${projectId ?? card.projectId ?? ""}/-/issues/${card.iid}`;
                  return (
                    <div
                      role="listitem"
                      key={cardKey(list.id, card.issue)}
                      class="sp-bcard"
                      aria-label={cardLabel(card, list.title)}
                      tabIndex={card.issue === tabbable ? 0 : -1}
                      data-card={cardKey(list.id, card.issue)}
                      data-issue={card.issue}
                      data-from-list={list.id}
                      data-lifted={lifted ? "true" : "false"}
                      data-movable={canMove ? "true" : undefined}
                      style={dragged && drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
                      onFocus={() => setRoving(card.issue)}
                      onKeyDown={(event) => onKeyDown(event, list, card, index)}
                    >
                      <span class="sp-bcard__ref">{card.project === null ? `#${card.iid}` : `${card.project}#${card.iid}`}</span>
                      <A href={href} tabIndex={-1} draggable={false} class="sp-bcard__title">
                        {card.title}
                      </A>
                      {card.labels.length > 0 ? (
                        <span class="sp-bcard__labels">
                          {card.labels.map((name) => (
                            <ScopedLabel key={name} name={name} />
                          ))}
                        </span>
                      ) : null}
                      <span class="sp-bcard__meta">
                        {card.weight === null ? null : <span>{`Weight ${card.weight}`}</span>}
                        {card.assignees.length > 0 ? <span>{card.assignees.map((name) => `@${name}`).join(" ")}</span> : null}
                        {card.confidential ? <span class="sp-bcard__flag">Confidential</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ) : resource.error ? null : (
        <Skeleton rows={3} height={96} />
      )}
    </>
  );
}

