import { useRef, useState } from "react";
import { request } from "../api.ts";
import { LOADING, REFRESH_FAILED } from "../copy.ts";
import { usePolling } from "../hooks.ts";
import type { BoardResponse } from "../../shared/domain.ts";

interface BoardFeed {
  board: BoardResponse | null;
  message: string;
}

function closeAnnouncement(board: BoardResponse): string {
  const date = board.clocks.equity.official_close?.date ?? board.market_date;
  return `Equity session closed. Share price is now the ${date} official close.`;
}

/**
 * The board as the server last reported it. A failed refresh keeps the last loaded state; the
 * session-close line is announced once, when two successive successful answers go from open to closed.
 */
export function useBoardFeed(): BoardFeed {
  const [feed, setFeed] = useState<BoardFeed>({ board: null, message: LOADING });
  const lastGood = useRef<BoardResponse | null>(null);
  const applied = useRef(0);

  usePolling(async (sequence) => {
    const answer = await request<BoardResponse>("GET", "/api/board");
    if (answer.kind !== "ok") {
      setFeed((current) => ({ ...current, message: REFRESH_FAILED }));
      return;
    }
    if (sequence < applied.current) return;
    applied.current = sequence;
    const before = lastGood.current;
    lastGood.current = answer.body;
    const closed = before?.clocks.equity.status === "open" && answer.body.clocks.equity.status === "closed";
    setFeed((current) => ({
      board: answer.body,
      message: closed ? closeAnnouncement(answer.body) : current.message === REFRESH_FAILED || current.message === LOADING ? "" : current.message,
    }));
  }, true);

  return feed;
}
