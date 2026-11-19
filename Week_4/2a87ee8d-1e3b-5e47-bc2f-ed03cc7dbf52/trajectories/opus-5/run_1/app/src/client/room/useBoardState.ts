import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import type { BoardResponse, BoardFrame, BoardNote } from '../../shared/protocol.js';

export interface PresenceCursor {
  readonly cursorId: string;
  readonly hue: number;
  readonly x: number;
  readonly y: number;
  readonly name?: string;
  readonly seenAt: number;
}

export interface RevealEvent {
  /** Frames to announce, in rail order, with the note total to read out. */
  readonly frames: ReadonlyArray<{ id: string; title: string; noteCount: number }>;
  /** The notes that were card backs in the last-rendered board. */
  readonly flippedNoteIds: ReadonlySet<string>;
  /** True when the stream had dropped since the last render. */
  readonly wasOffline: boolean;
  readonly key: number;
}

export interface BoardState {
  readonly board: BoardResponse | null;
  readonly previous: BoardResponse | null;
  readonly cursors: ReadonlyMap<string, PresenceCursor>;
  readonly streamDown: boolean;
  readonly ended: boolean;
  readonly reveal: RevealEvent | null;
  readonly serverOffsetMs: number;
  readonly refresh: () => Promise<void>;
  readonly clearReveal: () => void;
}

const CURSOR_TIMEOUT_MS = 10_000;

function cardBackIdsOf(board: BoardResponse): Set<string> {
  // A card back is a note received without its text.
  return new Set(
    board.notes.filter((note) => note.revealed === false && note.mine === false).map((note) => note.id),
  );
}

function ownUnrevealedFrameIds(board: BoardResponse): Set<string> {
  return new Set(
    board.notes.filter((note) => note.revealed === false && note.mine === true).map((note) => note.frameId),
  );
}

/**
 * Decides whether a render runs the reveal wave. It runs exactly once for each render whose
 * last-rendered board was in `silent_round` and whose new board is revealed, voting, closed or
 * archived, or has a higher round number. A board loaded fresh has no last-rendered board.
 */
function revealFor(
  previous: BoardResponse | null,
  next: BoardResponse,
  wasOffline: boolean,
  key: number,
): RevealEvent | null {
  if (previous === null) return null;
  const wasSilent = previous.workshop.status === 'silent_round';
  if (!wasSilent) return null;
  const nextStatus = next.workshop.status;
  const revealedNow =
    nextStatus === 'revealed' || nextStatus === 'voting' || nextStatus === 'closed' || nextStatus === 'archived';
  const higherRound = (next.workshop.round?.number ?? 0) > (previous.workshop.round?.number ?? 0);
  if (!revealedNow && !higherRound) return null;

  const flippedNoteIds = cardBackIdsOf(previous);
  const ownFrames = ownUnrevealedFrameIds(previous);
  const nextFrames = new Map(next.frames.map((frame) => [frame.id, frame]));
  const announced = [...previous.frames]
    .sort((a, b) => a.position - b.position)
    .filter((frame) => frame.hiddenCount > 0 || ownFrames.has(frame.id))
    .flatMap((frame) => {
      const updated = nextFrames.get(frame.id);
      return updated === undefined ? [] : [{ id: frame.id, title: frame.title, noteCount: updated.noteCount }];
    });

  if (flippedNoteIds.size === 0 && announced.length === 0) return null;
  return { frames: announced, flippedNoteIds, wasOffline, key };
}

export function useBoardState(workshopId: string): BoardState {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [previous, setPrevious] = useState<BoardResponse | null>(null);
  const [cursors, setCursors] = useState<ReadonlyMap<string, PresenceCursor>>(new Map());
  const [streamDown, setStreamDown] = useState(false);
  const [ended, setEnded] = useState(false);
  const [reveal, setReveal] = useState<RevealEvent | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  const lastRendered = useRef<BoardResponse | null>(null);
  const droppedSinceRender = useRef(false);
  const revealKey = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await api<BoardResponse>('GET', `/api/workshops/${workshopId}/board`);
      // The client corrects for the gap between its own clock and the server time.
      setServerOffsetMs(Date.parse(next.serverTime) - Date.now());
      const wasOffline = droppedSinceRender.current;
      droppedSinceRender.current = false;
      revealKey.current += 1;
      // Every board response is compared with the board rendered last.
      const event = revealFor(lastRendered.current, next, wasOffline, revealKey.current);
      if (event) setReveal(event);
      else if (wasOffline) {
        setReveal({ frames: [], flippedNoteIds: new Set(), wasOffline: true, key: revealKey.current });
      }
      setPrevious(lastRendered.current);
      lastRendered.current = next;
      setBoard(next);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'session_ended') setEnded(true);
    } finally {
      inFlight.current = false;
    }
  }, [workshopId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The live stream reconnects by itself and sends the last event id it received.
  useEffect(() => {
    const source = new EventSource(`/api/workshops/${workshopId}/stream`);
    source.addEventListener('open', () => setStreamDown(false));
    source.addEventListener('board', () => {
      void refresh();
    });
    source.addEventListener('presence', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as Omit<PresenceCursor, 'seenAt'>;
      setCursors((current) => new Map(current).set(data.cursorId, { ...data, seenAt: Date.now() }));
    });
    source.addEventListener('ended', () => {
      setEnded(true);
      source.close();
    });
    source.addEventListener('error', () => {
      setStreamDown(true);
      droppedSinceRender.current = true;
    });
    return () => source.close();
  }, [workshopId, refresh]);

  // A cursor with no update for 10 seconds disappears.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCursors((current) => {
        const now = Date.now();
        const next = new Map(current);
        let changed = false;
        for (const [id, cursor] of current) {
          if (now - cursor.seenAt > CURSOR_TIMEOUT_MS) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const clearReveal = useCallback(() => setReveal(null), []);

  return {
    board,
    previous,
    cursors,
    streamDown,
    ended,
    reveal,
    serverOffsetMs,
    refresh,
    clearReveal,
  };
}

export function framesInRailOrder(frames: readonly BoardFrame[]): BoardFrame[] {
  return [...frames].sort((a, b) => a.position - b.position);
}

/** A note the viewer cannot read renders as an outline-only card back with no text nodes. */
export function isCardBack(note: BoardNote): boolean {
  return note.revealed === false && note.mine === false;
}
