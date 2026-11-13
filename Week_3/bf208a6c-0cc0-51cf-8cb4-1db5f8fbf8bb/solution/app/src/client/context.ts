import { createContext, useContext, type KeyboardEvent, type MouseEvent, type PointerEvent, type TouchEvent } from "react";
import type { Hold } from "./layout";
import type { Account, Board, Post, Role } from "../shared/types";

export interface FrameHandlers {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
}

export interface BoardUi {
  board: Board;
  me: Account | null;
  role: Role | null;
  loupe: { id: string; width: number } | null;
  hold: Hold | null;
  /** Comment arrivals per post, to refetch an open loupe's comments. */
  ticks: Record<string, number>;
  bind: (post: Post) => FrameHandlers;
  closeLoupe: (postId: string) => void;
  announce: (line: string) => void;
  requestFocus: (selector: string) => void;
  reload: () => Promise<unknown>;
  edit: (post: Post) => void;
  remove: (post: Post) => void;
}

export const BoardContext = createContext<BoardUi | null>(null);

export function useBoardUi(): BoardUi {
  const ui = useContext(BoardContext);
  if (!ui) throw new Error("useBoardUi outside a board");
  return ui;
}
