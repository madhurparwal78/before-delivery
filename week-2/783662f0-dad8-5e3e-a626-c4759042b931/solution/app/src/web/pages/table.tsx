import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import * as copy from '../../shared/copy.js';
import { COPY } from '../../shared/copy.js';
import { cardName } from '../../shared/domain.js';
import type { CharacterObject, TableObject } from '../../shared/types.js';
import { ApiFailure, get, post, remove } from '../api.js';
import { ChessBoard, discLabel, fourCellName } from '../boards.js';
import {
  cardDeal,
  cardFlip,
  discDrop,
  tableDrawIn,
  tableDrawOut,
  tokenSlide,
  turnFuse,
} from '../motion.js';
import { play } from '../sound.js';
import { useTableStream } from '../stream.js';
import { Dialog, GridRows, useGrid, useReducedMotion, useServerCountdown } from '../ui.js';

interface Props {
  readonly table: TableObject;
  readonly character: CharacterObject | null;
  /** The table's map tile, which the panel grows from and shrinks back to. */
  readonly tileRect: () => DOMRect | null;
  /** True when a Take seat or Watch answer opened the panel; false on a direct open. */
  readonly drawIn: boolean;
  readonly onClose: (stoodUp: boolean) => void;
  readonly onSettled: () => void;
}

export function TablePanel({
  table,
  character,
  tileRect,
  drawIn,
  onClose,
  onSettled,
}: Props): ReactNode {
  const [state, setState] = useState(table);
  const [announcement, setAnnouncement] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [promotionFor, setPromotionFor] = useState<{ from: string; to: string } | null>(null);
  const [forfeiting, setForfeiting] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const fullScreenButton = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const warned = useRef(false);
  const settledOnce = useRef(false);

  const mySeat =
    character === null
      ? null
      : (state.seats.find((seat) => seat.character?.id === character.id)?.seat ?? null);
  const myTurn = mySeat !== null && state.to_move_seat === mySeat;

  /* Counts the table pushes received. An answer that comes back after a push
     never replaces it: the push is the newer state, since the server publishes
     every change before it answers. */
  const pushes = useRef(0);
  const reload = useCallback(async () => {
    const before = pushes.current;
    const fresh = await get<TableObject>(`/api/tables/${table.id}`);
    if (pushes.current === before) setState(fresh);
  }, [table.id]);

  /* The panel's focus target, by game and by whether you are seated. */
  const focusTarget = useCallback((): string | null => {
    if (state.game === 'chess') return mySeat === 2 ? 'h1' : 'a8';
    return null;
  }, [state.game, mySeat]);

  const [focusSquare, setFocusSquare] = useState<string | null>(focusTarget());
  const dropButton = useRef<HTMLButtonElement>(null);
  const handList = useRef<HTMLUListElement>(null);
  const trickRegion = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* Opening the route directly or by reload shows the panel already open;
       only a confirmed seat or watch grows it out of the tile. */
    if (!drawIn) return;
    tableDrawIn(panel.current, tileRect());
    const tokens = panel.current?.querySelectorAll<HTMLElement>('[data-token]') ?? [];
    window.setTimeout(() => {
      for (const token of tokens) tokenSlide(token, false);
    }, 460);
    // The draw-in runs once, when the server's answer has opened the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Closing reverses the draw-in: tokens slide back and the panel shrinks to
     the exact tile; a second close request while shrinking is ignored. */
  const closing = useRef(false);
  const close = (stoodUp: boolean): void => {
    if (closing.current) return;
    closing.current = true;
    const tile = tileRect();
    if (reduced || tile === null || panel.current === null) {
      onClose(stoodUp);
      return;
    }
    for (const token of panel.current.querySelectorAll<HTMLElement>('[data-token]')) {
      tokenSlide(token, true);
    }
    void tableDrawOut(panel.current, tile).then(() => onClose(stoodUp));
  };

  const focusPanelTarget = (): void => {
    if (state.game === 'chess') setFocusSquare(focusTarget());
    else if (state.game === 'four') {
      if (mySeat !== null) dropButton.current?.focus();
      else panel.current?.querySelector<HTMLElement>('[data-cell="0-0"]')?.focus();
    } else if (state.hand !== null && state.hand.length > 0) handList.current?.focus();
    else trickRegion.current?.focus();
  };

  useEffect(() => {
    focusPanelTarget();
    // The focus target is set when the panel opens for this seat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySeat, state.game]);

  useTableStream(table.id, (event) => {
    if (event.kind === 'table') {
      const next = event.payload as TableObject;
      pushes.current += 1;
      setState(next);
      if (next.settled && !settledOnce.current) {
        settledOnce.current = true;
        const line = next.result?.settlement.find(
          (entry) => entry.character_id === character?.id,
        );
        if (line !== undefined) {
          setAnnouncement(copy.coinsSettled(signedOf(line.amount)));
          onSettled();
          play(line.amount > 0 ? 'game-won' : 'game-lost');
        }
      }
      if (next.pending_store && next.result !== null && !next.settled) {
        setAnnouncement(COPY.resultNotStored);
      }
    } else if (event.kind === 'announcement') {
      const text = (event.payload as { text: string }).text;
      /* For a seated player the settled line replaces the end copy, however
         the two pushes interleave. */
      if (settledOnce.current && text === state.result?.text) return;
      setAnnouncement(text);
    }
  });

  /* When the server ends the turn or the game, the promotion picker and the
     forfeit dialog close and focus moves to the panel's focus target. */
  const inPlay = state.state === 'in_play';
  const wasInPlay = useRef(inPlay);
  useEffect(() => {
    if (wasInPlay.current && !inPlay) {
      setForfeiting(false);
      setPromotionFor(null);
      focusPanelTarget();
    }
    wasInPlay.current = inPlay;
    // Runs on the in-play edge only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inPlay]);

  const remaining = state.turn_remaining_ms;
  const seconds = useServerCountdown(remaining);
  const fuseRing = useRef<SVGCircleElement>(null);
  /* The fuse restarts from the server's remaining time on each new turn. */
  useEffect(() => {
    const ring = fuseRing.current;
    if (ring === null || remaining === null) return;
    for (const running of ring.getAnimations()) running.cancel();
    turnFuse(ring, remaining / (state.turn_seconds * 1000), remaining);
    // A new turn, game or seat to move restarts the fuse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.game_id, state.turn, state.to_move_seat, state.state]);

  useEffect(() => {
    if (!myTurn || seconds === null) {
      warned.current = false;
      return;
    }
    if (seconds <= 10 && !warned.current) {
      warned.current = true;
      play('turn-warning');
    }
  }, [myTurn, seconds]);

  const clockText =
    state.to_move_seat === null || seconds === null
      ? ''
      : myTurn
        ? copy.yourTurnClock(seconds)
        : copy.theirTurnClock(
            state.seats.find((seat) => seat.seat === state.to_move_seat)?.character?.name ?? '',
            seconds,
          );

  const sendMove = async (move: string): Promise<void> => {
    if (character === null) return;
    const before = pushes.current;
    try {
      const answer = await post<{ announcement: string; table: TableObject }>(
        `/api/tables/${table.id}/moves`,
        { character_id: character.id, turn: state.turn, move },
      );
      if (pushes.current === before) setState(answer.table);
      setAnnouncement(answer.announcement);
      setSelected(null);
      play('move-accepted');
      if (answer.table.result !== null) await reload();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setAnnouncement(moveRefusal(error));
        play('move-refused');
      }
      setSelected(null);
    }
  };

  const toggleFullScreen = (): void => {
    const node = panel.current;
    if (node === null) return;
    if (document.fullscreenElement === node) {
      void document.exitFullscreen().then(() => fullScreenButton.current?.focus());
      return;
    }
    node.requestFullscreen().catch(() => {
      setAnnouncement(COPY.fullScreenUnavailable);
    });
  };

  useEffect(() => {
    const onChange = (): void => setFullScreen(document.fullscreenElement === panel.current);
    document.addEventListener('fullscreenchange', onChange);
    const onError = (): void => setAnnouncement(COPY.fullScreenUnavailable);
    panel.current?.addEventListener('fullscreenerror', onError);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);

  return (
    <div className={reduced ? 'table-backdrop' : 'table-backdrop'}>
      <div
        className="table-panel"
        role="dialog"
        aria-modal="true"
        aria-label={state.name}
        ref={panel}
        tabIndex={-1}
        onKeyDown={(event) => {
          const key = event.key.toLowerCase();
          const inField = isField(event.target);
          if (key === 't' && !inField) {
            event.preventDefault();
            setAnnouncement(clockText);
          } else if (key === 'f' && !inField) {
            event.preventDefault();
            toggleFullScreen();
          } else if (event.key === 'Escape') {
            /* Escape closes the innermost open dialog, or the panel itself. */
            if (promotionFor !== null || forfeiting) return;
            event.preventDefault();
            close(false);
          }
        }}
      >
        <h2>{state.name}</h2>

        <ul aria-label="Seats" className="row">
          {state.seats.map((seat) => (
            <li key={seat.seat} data-token="seat">
              {`${seat.label}: ${seat.character?.name ?? 'free'}`}
              {state.to_move_seat === seat.seat && state.state === 'in_play' && !reduced ? (
                <svg className="fuse" viewBox="0 0 36 36" aria-hidden="true">
                  <circle
                    ref={fuseRing}
                    cx="18"
                    cy="18"
                    r="16"
                    pathLength={1}
                    strokeDasharray="1"
                    data-anim="turn-fuse"
                    data-phase="start"
                  />
                </svg>
              ) : null}
            </li>
          ))}
        </ul>

        <ul aria-label="Spectators" className="row">
          {state.spectators.map((spectator) => (
            <li key={spectator.character_id} data-token="spectator">
              {spectator.name}
            </li>
          ))}
        </ul>

        <p role="timer" aria-label="Turn clock" className="clock mono">
          {clockText}
        </p>

        {state.game === 'chess' && state.position !== null && 'fen' in state.position ? (
          <ChessBoard
            fen={state.position.fen}
            mySeat={mySeat}
            selected={selected}
            focusSquare={focusSquare}
            onSelect={setSelected}
            onMove={(from, to) => {
              /* A pawn reaching the last rank opens the picker before anything
                 is sent. */
              const squares = state.position !== null && 'fen' in state.position
                ? state.position.fen.split(' ')[0]
                : '';
              if (needsPromotion(squares, from, to)) {
                setPromotionFor({ from, to });
                return;
              }
              void sendMove(`${from}${to}`);
            }}
          />
        ) : null}

        {state.game === 'four' && state.position !== null && 'rows' in state.position ? (
          <FourBoard
            rows={state.position.rows}
            seated={mySeat !== null}
            dropRef={dropButton}
            onDrop={(column) => void sendMove(String(column))}
          />
        ) : null}

        {state.game === 'tricks' && state.position !== null && 'trick' in state.position ? (
          <CardTable
            table={state}
            handRef={handList}
            trickRef={trickRegion}
            onPlay={(card) => void sendMove(card)}
          />
        ) : null}

        <div className="row">
          {state.state === 'seated' && mySeat !== null ? (
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (character === null) return;
                void post(`/api/tables/${table.id}/start`, { character_id: character.id })
                  .then(reload)
                  .catch((error: unknown) => {
                    if (error instanceof ApiFailure) setAnnouncement(error.message);
                  });
              }}
            >
              Start game
            </button>
          ) : null}
          {mySeat !== null ? (
            <button
              type="button"
              onClick={() => {
                if (character === null) return;
                void remove(`/api/tables/${table.id}/seats/${character.id}`)
                  .then(() => close(true))
                  .catch((error: unknown) => {
                    if (error instanceof ApiFailure) {
                      setAnnouncement(
                        error.code === 'game_in_play'
                          ? COPY.standUpInPlay
                          : error.code === 'not_settled'
                            ? COPY.standUpNotSettled
                            : error.message,
                      );
                    }
                  });
              }}
            >
              Stand up
            </button>
          ) : null}
          {mySeat !== null && state.state === 'in_play' ? (
            <button type="button" onClick={() => setForfeiting(true)}>
              Forfeit
            </button>
          ) : null}
          {mySeat !== null && state.state === 'settled' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (character === null) return;
                  void post(`/api/tables/${table.id}/rematch`, { character_id: character.id })
                    .then(reload)
                    .catch(() => undefined);
                }}
              >
                Offer rematch
              </button>
              <button
                type="button"
                onClick={() => {
                  if (character === null) return;
                  void post(`/api/tables/${table.id}/rematch`, { character_id: character.id })
                    .then(reload)
                    .catch(() => undefined);
                }}
              >
                Accept rematch
              </button>
            </>
          ) : null}
          <button type="button" onClick={() => close(false)}>
            Close table
          </button>
          <button
            type="button"
            ref={fullScreenButton}
            aria-pressed={fullScreen}
            onClick={toggleFullScreen}
          >
            {fullScreen ? 'Exit full screen' : 'Full screen'}
          </button>
        </div>

        <p role="status" aria-label="Game announcements" aria-live="polite">
          {announcement}
        </p>

        {promotionFor !== null ? (
          <Dialog
            label="Choose promotion piece"
            onClose={() => {
              setPromotionFor(null);
              setSelected(null);
            }}
            returnFocus={() =>
              panel.current?.querySelector<HTMLElement>(
                `[data-square="${promotionFor.from}"]`,
              ) ?? null
            }
          >
            <h3>Choose promotion piece</h3>
            <div className="row">
              {(
                [
                  ['Queen', 'q'],
                  ['Rook', 'r'],
                  ['Bishop', 'b'],
                  ['Knight', 'n'],
                ] as const
              ).map(([label, letter]) => (
                <button
                  key={letter}
                  type="button"
                  onClick={() => {
                    const move = `${promotionFor.from}${promotionFor.to}${letter}`;
                    setPromotionFor(null);
                    void sendMove(move);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </Dialog>
        ) : null}

        {forfeiting ? (
          <ForfeitDialog
            onClose={() => setForfeiting(false)}
            onForfeit={() => {
              if (character === null) return;
              setForfeiting(false);
              void post(`/api/tables/${table.id}/forfeit`, { character_id: character.id })
                .then(reload)
                .catch(() => undefined);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

const signedOf = (amount: number): string =>
  amount === 0 ? '0' : amount > 0 ? `+${amount}` : `-${Math.abs(amount)}`;

const isField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

function needsPromotion(placement: string, from: string, to: string): boolean {
  const rows = placement.split('/');
  const fromRank = 8 - Number(from[1]);
  const fromFile = 'abcdefgh'.indexOf(from[0]);
  let file = 0;
  let piece = '.';
  for (const char of rows[fromRank] ?? '') {
    if (/\d/.test(char)) file += Number(char);
    else {
      if (file === fromFile) {
        piece = char;
        break;
      }
      file += 1;
    }
  }
  const lastRank = to[1] === '8' || to[1] === '1';
  return piece.toLowerCase() === 'p' && lastRank;
}

const moveRefusal = (error: ApiFailure): string => {
  if (error.code === 'stale_turn') return COPY.staleTurn;
  if (error.code === 'turn_expired') return COPY.turnExpired;
  return error.message;
};

function ForfeitDialog({
  onClose,
  onForfeit,
}: {
  onClose: () => void;
  onForfeit: () => void;
}): ReactNode {
  const keepPlaying = useRef<HTMLButtonElement>(null);
  return (
    <Dialog label="Forfeit this game?" onClose={onClose} initialFocus={keepPlaying}>
      <h3>Forfeit this game?</h3>
      <div className="row">
        <button type="button" ref={keepPlaying} onClick={onClose}>
          Keep playing
        </button>
        <button type="button" onClick={onForfeit}>
          Forfeit game
        </button>
      </div>
    </Dialog>
  );
}

function FourBoard({
  rows,
  seated,
  dropRef,
  onDrop,
}: {
  rows: readonly string[];
  seated: boolean;
  dropRef: React.RefObject<HTMLButtonElement>;
  onDrop: (column: number) => void;
}): ReactNode {
  const grid = useGrid(7, 6, { x: 0, y: 0 });
  const host = useRef<HTMLDivElement>(null);
  const previous = useRef<string>(rows.join(''));

  useEffect(() => {
    const now = rows.join('');
    if (now === previous.current) return;
    for (let i = 0; i < now.length; i += 1) {
      if (now[i] !== previous.current[i] && now[i] !== '.') {
        const node = host.current?.querySelector<HTMLElement>(
          `[data-cell="${Math.floor(i / 7)}-${i % 7}"] span`,
        );
        discDrop(node ?? null, Math.floor(i / 7) + 1);
        break;
      }
    }
    previous.current = now;
  }, [rows]);

  return (
    <>
      <div
        className="board four"
        role="grid"
        aria-label="Four in a row board"
        ref={host}
        onKeyDown={(event) => {
          if (grid.onKeyDown(event)) {
            event.preventDefault();
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onDrop(grid.cursor.x + 1);
          }
        }}
      >
        <GridRows columns={7}>{rows.flatMap((row, rowIndex) =>
          [...row].map((disc, column) => {
            const isCursor = grid.cursor.x === column && grid.cursor.y === rowIndex;
            return (
              <div
                key={`${rowIndex}-${column}`}
                role="gridcell"
                data-cell={`${rowIndex}-${column}`}
                aria-label={`${fourCellName(rowIndex, column)}, ${discLabel(disc)}`}
                tabIndex={isCursor ? 0 : -1}
                ref={(node) => grid.register(column, rowIndex, node)}
                onFocus={() => grid.setCursor({ x: column, y: rowIndex })}
                className={`square ${isCursor ? 'cursor' : ''}`}
                onClick={() => {
                  grid.focusCell(column, rowIndex);
                  onDrop(column + 1);
                }}
              >
                {disc === '.' ? null : (
                  <span className={`disc ${disc === 'I' ? 'ink' : 'gold'}`} aria-hidden="true" />
                )}
              </div>
            );
          }),
        )}</GridRows>
      </div>
      {seated ? (
        <div className="row">
          {Array.from({ length: 7 }, (_, index) => (
            <button
              key={index}
              type="button"
              ref={index === 0 ? dropRef : undefined}
              onClick={() => onDrop(index + 1)}
            >
              {`Drop in column ${index + 1}`}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function CardTable({
  table,
  handRef,
  trickRef,
  onPlay,
}: {
  table: TableObject;
  handRef: React.RefObject<HTMLUListElement>;
  trickRef: React.RefObject<HTMLDivElement>;
  onPlay: (card: string) => void;
}): ReactNode {
  const hand = table.hand ?? [];
  const [active, setActive] = useState(0);
  const trick =
    table.position !== null && 'trick' in table.position ? table.position.trick : [];
  const host = useRef<HTMLDivElement>(null);
  const played = useRef(0);
  const dealt = useRef(false);

  useEffect(() => {
    if (trick.length === played.current) return;
    played.current = trick.length;
    const node = host.current?.querySelector<HTMLElement>('[data-trick-last]');
    cardFlip(node ?? null);
  }, [trick.length]);

  /* At game start each card flies from the deck to its seat, in deal order. */
  useEffect(() => {
    if (hand.length === 0) {
      dealt.current = false;
      return;
    }
    if (dealt.current) return;
    dealt.current = true;
    const cards = host.current?.querySelectorAll<HTMLElement>('[data-hand-card]') ?? [];
    const deck = trickRef.current?.getBoundingClientRect() ?? null;
    cards.forEach((card, order) => cardDeal(card, order, deck));
  }, [hand.length]);

  return (
    <div ref={host} className="stack">
      <div role="region" aria-label="Current trick" ref={trickRef} tabIndex={-1}>
        <h3>Current trick</h3>
        <ul className="hand">
          {trick.map((play_, index) => (
            <li
              key={`${play_.seat}-${play_.card}`}
              data-trick-last={index === trick.length - 1 ? 'true' : undefined}
            >
              {cardName(play_.card)}
            </li>
          ))}
        </ul>
      </div>
      {table.hand !== null ? (
        <ul
          className="hand"
          role="listbox"
          aria-label="Your hand"
          tabIndex={0}
          ref={handRef}
          aria-activedescendant={hand[active] === undefined ? undefined : `card-${hand[active]}`}
          onKeyDown={(event) => {
            if (['ArrowRight', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, hand.length - 1));
            } else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === 'Home') {
              event.preventDefault();
              setActive(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setActive(Math.max(0, hand.length - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const card = hand[active];
              if (card !== undefined) onPlay(card);
            }
          }}
        >
          {hand.map((card, index) => (
            <li
              key={card}
              id={`card-${card}`}
              role="option"
              data-hand-card="true"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                setActive(index);
                onPlay(card);
              }}
            >
              {cardName(card)}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="row" aria-label="Cards held">
        {table.hand_counts.map((count, seat) => (
          <li key={seat} className="mono">
            {`${table.seats[seat]?.label ?? seat + 1}: ${count}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
