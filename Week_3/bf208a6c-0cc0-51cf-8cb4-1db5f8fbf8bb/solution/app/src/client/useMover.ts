import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type TouchEvent } from "react";
import { ApiFailure, call } from "./api";
import type { FrameHandlers } from "./context";
import { canMove, lines, placeOf, withHold, type Hold } from "./layout";
import { maxPosition } from "../shared/order";
import { MESSAGES, orderLockedMessage } from "../shared/rules";
import type { Account, Board, Listing, Post, Role } from "../shared/types";

const DRAG_START_PX = 8;
const LONG_PRESS_MS = 500;

export const frameSelector = (postId: string): string => `[data-post-id="${postId}"]`;

interface Env {
  board: Board;
  listing: Listing;
  me: Account | null;
  role: Role | null;
  loupeId: string | null;
  announce: (line: string) => void;
  reload: () => Promise<{ listing: Listing } | null>;
  openLoupe: (post: Post, element: HTMLElement) => void;
  closeLoupe: (postId: string) => void;
  requestFocus: (selector: string) => void;
}

const INTERACTIVE = "button, a, input, textarea, select, ul";

/** Where the pointer is over the sheet: a frame (take its place) or a section's empty space (go last). */
function targetAt(x: number, y: number, draggedId: string, listing: Listing): { sectionId: string; position: number } | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const frame = element.closest<HTMLElement>("[data-post-id]");
    if (frame?.dataset["postId"] === draggedId) continue;
    const section = element.closest<HTMLElement>("[data-section-id][data-count]");
    if (!section) continue;
    const sectionId = section.dataset["sectionId"] ?? "";
    if (frame) return { sectionId, position: Number(frame.dataset["position"]) };
    const others = listing.sections.find((candidate) => candidate.id === sectionId)?.posts.filter((post) => post.id !== draggedId).length ?? 0;
    return { sectionId, position: maxPosition(others) };
  }
  return null;
}

/** Picking up, stepping, dropping and cancelling posts by key, mouse and touch. */
export function useMover(env: Env) {
  const [hold, setHold] = useState<Hold | null>(null);
  const holdRef = useRef<Hold | null>(null);
  const envRef = useRef(env);
  envRef.current = env;
  const suppressClick = useRef(false);

  const updateHold = useCallback((next: Hold | null) => {
    holdRef.current = next;
    setHold(next);
  }, []);

  const pickUp = (post: Post, mode: Hold["mode"]): Hold | null => {
    const at = placeOf(envRef.current.listing.sections, post.id);
    if (!at) return null;
    const held: Hold = {
      postId: post.id,
      title: post.title,
      version: post.version,
      mode,
      origin: { sectionId: at.section.id, position: at.position },
      sectionId: at.section.id,
      position: at.position,
      offset: { x: 0, y: 0 },
      saving: false,
    };
    updateHold(held);
    return held;
  };

  /** Sends the held post's place to the server and says where it ended up. */
  const drop = async (held: Hold): Promise<void> => {
    if (held.saving) return;
    updateHold({ ...held, saving: true });
    const { announce, reload, requestFocus } = envRef.current;
    let failure: ApiFailure | null = null;
    try {
      await call("PATCH", `/api/posts/${held.postId}/move`, { section_id: held.sectionId, position: held.position, version: held.version });
    } catch (error) {
      if (!(error instanceof ApiFailure)) {
        updateHold(null);
        throw error;
      }
      failure = error;
    }
    const fresh = await reload();
    updateHold(null);
    const at = fresh ? placeOf(fresh.listing.sections, held.postId) : null;
    if (!failure && at) announce(lines.dropped(held.title, at));
    else if (failure?.status === 409 && at) announce(lines.lost(failure.body.moved_by ?? "", held.title, at));
    else if (failure?.status === 422) announce(failure.firstError);
    requestFocus(frameSelector(held.postId));
  };

  const cancel = (held: Hold): void => {
    updateHold(null);
    const { listing, announce, requestFocus } = envRef.current;
    const section = listing.sections.find((candidate) => candidate.id === held.origin.sectionId);
    if (section) {
      const present = section.posts.some((post) => post.id === held.postId);
      announce(lines.cancelled(held.title, { section, position: held.origin.position, count: section.posts.length + (present ? 0 : 1) }));
    }
    requestFocus(frameSelector(held.postId));
  };

  /** One arrow key while a post is picked up. */
  const step = (held: Hold, key: string): void => {
    const { board, listing, announce } = envRef.current;
    const columns = board.layout === "columns";
    const within = ((columns ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 }) as Record<string, number>)[key];
    const across = ((columns ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 }) as Record<string, number>)[key];
    if (within === undefined && across === undefined) return;
    if (board.group === "author") return announce(MESSAGES.movingOffByAuthor);
    if (within !== undefined && board.sort !== "by_hand") return announce(orderLockedMessage(board.sort));
    const groups = withHold(listing, board, held);
    const here = placeOf(groups, held.postId);
    if (!here) return;
    let next = held;
    if (within !== undefined) {
      next = { ...held, position: Math.min(Math.max(held.position + within, 1), here.count) };
    } else {
      const index = groups.findIndex((group) => group.id === held.sectionId);
      const target = groups[Math.min(Math.max(index + (across ?? 0), 0), groups.length - 1)];
      if (target && target.id !== held.sectionId) next = { ...held, sectionId: target.id, position: Math.min(held.position, maxPosition(target.posts.length)) };
    }
    const there = placeOf(withHold(listing, board, next), held.postId);
    if (!there) return;
    updateHold({ ...next, position: there.position });
    announce(lines.step(held.title, there));
  };

  /** Ends a drag at a point: blocked drags go back, others are saved. */
  const release = (held: Hold, x: number, y: number): void => {
    const { board, listing, announce } = envRef.current;
    const target = targetAt(x, y, held.postId, listing);
    if (!target) return cancel(held);
    if (board.group === "author") {
      updateHold(null);
      return announce(MESSAGES.movingOffByAuthor);
    }
    if (board.sort !== "by_hand" && target.sectionId === held.origin.sectionId) {
      updateHold(null);
      return announce(orderLockedMessage(board.sort));
    }
    void drop({ ...held, sectionId: target.sectionId, position: target.position, offset: { x: 0, y: 0 } });
  };

  const bind = (post: Post): FrameHandlers => {
    const movable = canMove(post, env.role, env.me?.id ?? null);
    const open = env.loupeId === post.id;

    const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
      const held = holdRef.current;
      if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        return env.closeLoupe(post.id);
      }
      if (event.target !== event.currentTarget) return;
      if (held?.postId === post.id && held.mode === "keyboard") {
        if (event.key === " ") {
          event.preventDefault();
          void drop(held);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel(held);
        } else if (event.key.startsWith("Arrow")) {
          event.preventDefault();
          step(held, event.key);
        }
      } else if (event.key === "Enter" && !held && !open) {
        event.preventDefault();
        env.openLoupe(post, event.currentTarget);
      } else if (event.key === " ") {
        event.preventDefault();
        if (!movable || held || open) return;
        const picked = pickUp(post, "keyboard");
        const at = picked && placeOf(env.listing.sections, post.id);
        if (at) env.announce(lines.pickedUp(post.title, at));
      }
    };

    const onClick = (event: MouseEvent<HTMLElement>): void => {
      if ((event.target as HTMLElement).closest(INTERACTIVE) || holdRef.current) return;
      if (open) {
        if (!window.getSelection()?.toString()) env.closeLoupe(post.id);
      } else {
        env.openLoupe(post, event.currentTarget);
      }
    };

    const onClickCapture = (event: MouseEvent<HTMLElement>): void => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.stopPropagation();
    };

    const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !movable || open || holdRef.current) return;
      const start = { x: event.clientX, y: event.clientY };
      let started: Hold | null = null;
      const move = (moved: globalThis.PointerEvent): void => {
        const offset = { x: moved.clientX - start.x, y: moved.clientY - start.y };
        if (!started && Math.hypot(offset.x, offset.y) >= DRAG_START_PX) started = pickUp(post, "pointer");
        if (started) updateHold({ ...started, offset });
      };
      const up = (released: globalThis.PointerEvent): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (started) {
          suppressClick.current = true;
          release({ ...started, offset: { x: released.clientX - start.x, y: released.clientY - start.y } }, released.clientX, released.clientY);
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

    const onTouchStart = (event: TouchEvent<HTMLElement>): void => {
      const first = event.touches[0];
      if (!first || !movable || open || holdRef.current) return;
      const start = { x: first.clientX, y: first.clientY };
      let started: Hold | null = null;
      let last = start;
      const timer = window.setTimeout(() => {
        started = pickUp(post, "pointer");
      }, LONG_PRESS_MS);
      const move = (moved: globalThis.TouchEvent): void => {
        const touch = moved.touches[0];
        if (!touch) return;
        last = { x: touch.clientX, y: touch.clientY };
        if (!started) {
          if (Math.hypot(last.x - start.x, last.y - start.y) >= DRAG_START_PX) window.clearTimeout(timer);
          return;
        }
        moved.preventDefault();
        updateHold({ ...started, offset: { x: last.x - start.x, y: last.y - start.y } });
      };
      const end = (finished: globalThis.TouchEvent): void => {
        window.clearTimeout(timer);
        window.removeEventListener("touchmove", move);
        window.removeEventListener("touchend", end);
        window.removeEventListener("touchcancel", end);
        if (started && finished.type === "touchend") {
          finished.preventDefault();
          suppressClick.current = true;
          release({ ...started, offset: { x: last.x - start.x, y: last.y - start.y } }, last.x, last.y);
        } else if (started) {
          updateHold(null);
        }
      };
      window.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("touchend", end, { passive: false });
      window.addEventListener("touchcancel", end);
    };

    return { onKeyDown, onClick, onClickCapture, onPointerDown, onTouchStart };
  };

  return { hold, holdRef, updateHold, bind };
}
