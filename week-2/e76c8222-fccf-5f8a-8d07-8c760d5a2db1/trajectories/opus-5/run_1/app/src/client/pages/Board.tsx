import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiCallError, api } from '../api';
import { BoardDetail } from '../components/BoardDetail';
import { DragState, GateView, prefersReducedMotion, targetSeat } from '../components/boardState';
import { LiveRegion } from '../components/LiveRegion';
import { MatchThread } from '../components/MatchThread';
import { RequestCard } from '../components/RequestCard';
import { agencyDateOf } from '../../shared/time';
import { dayHeading } from '../format';
import { BoardInterpreter, BoardPayload, GateResult, RequestObject, UserSummary } from '../types';

const REFRESH_MS = 5000;
const DRY_RUN_TIMEOUT_MS = 5000;
const STAGGER_MS = 100;
const PIN_SETTLE_MS = 260;
const RECOIL_SETTLE_MS = 400;

interface PendingDryRun {
  token: number;
  interpreterId: string;
  seatId: string;
  requestId: string;
  promise: Promise<GateResult[]>;
}

function gateSummary(ref: string, position: number, gates: GateResult[]): string {
  const state = (index: number): string => (gates[index]?.pass ? 'pass' : 'fail');
  return (
    `${ref} seat ${position}: Credential ${state(0)}, Valid on date ${state(1)}, ` +
    `Schedule ${state(2)}, Consumer ${state(3)}.`
  );
}

function withTimeout(promise: Promise<GateResult[]>): Promise<GateResult[]> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), DRY_RUN_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('dry-run failed'));
      },
    );
  });
}

export function Board(): ReactElement {
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preferred, setPreferred] = useState<UserSummary[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [threadPhase, setThreadPhase] = useState<'held' | 'pinning' | 'recoiling'>('held');
  const [pinPoint, setPinPoint] = useState<{ x: number; y: number } | null>(null);
  const [gateViews, setGateViews] = useState<Record<string, GateView>>({});
  const [cardMessages, setCardMessages] = useState<Record<string, string>>({});
  const [gateStatus, setGateStatus] = useState('');
  const [boardStatus, setBoardStatus] = useState('');
  const [rollingId, setRollingId] = useState<string | null>(null);
  const [wide, setWide] = useState(() => window.innerWidth >= 900);
  const [tab, setTab] = useState<'requests' | 'detail'>('requests');
  const [firstLoad, setFirstLoad] = useState(true);

  const dragRef = useRef<DragState | null>(null);
  const pendingRef = useRef<PendingDryRun | null>(null);
  const tokenRef = useRef(0);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const seatRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const staggerTimers = useRef<number[]>([]);

  const reduced = prefersReducedMotion();

  const loadBoard = useCallback(async (): Promise<void> => {
    try {
      const next = await api.board();
      setBoard(next);
    } catch {
      setBoardStatus('Could not load the board.');
    }
  }, []);

  useEffect(() => {
    void loadBoard();
    const timer = window.setInterval(() => void loadBoard(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadBoard]);

  useEffect(() => {
    const onResize = (): void => setWide(window.innerWidth >= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!board) return;
    const timer = window.setTimeout(() => setFirstLoad(false), 700);
    return () => window.clearTimeout(timer);
  }, [board]);

  const requests = board?.requests ?? [];
  const selected = requests.find((request) => request.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) {
      setPreferred([]);
      return;
    }
    let live = true;
    void api
      .consumerPreferences(selected.consumer.id)
      .then((payload) => {
        if (!live || !board) return;
        const names = board.interpreters.filter((item) => payload.preferred.includes(item.id));
        setPreferred(names.map((item) => ({ id: item.id, name: item.name })));
      })
      .catch(() => setPreferred([]));
    return () => {
      live = false;
    };
  }, [selected?.consumer.id, board, selected]);

  const clearStagger = (): void => {
    staggerTimers.current.forEach((timer) => window.clearTimeout(timer));
    staggerTimers.current = [];
  };

  const revealGates = useCallback(
    (requestId: string, gates: GateResult[]): void => {
      clearStagger();
      if (reduced) {
        setGateViews((current) => ({
          ...current,
          [requestId]: { phase: 'resolved', gates, revealed: 4 },
        }));
        return;
      }
      setGateViews((current) => ({
        ...current,
        [requestId]: { phase: 'resolved', gates, revealed: 1 },
      }));
      for (let step = 2; step <= 4; step += 1) {
        const timer = window.setTimeout(() => {
          setGateViews((current) => {
            const view = current[requestId];
            if (!view || view.phase !== 'resolved') return current;
            return { ...current, [requestId]: { ...view, revealed: Math.max(view.revealed, step) } };
          });
        }, STAGGER_MS * (step - 1));
        staggerTimers.current.push(timer);
      }
    },
    [reduced],
  );

  const settleGatesAtOnce = (requestId: string): void => {
    clearStagger();
    setGateViews((current) => {
      const view = current[requestId];
      if (!view || view.phase !== 'resolved') return current;
      return { ...current, [requestId]: { ...view, revealed: 4 } };
    });
  };

  const startDryRun = useCallback(
    (request: RequestObject): void => {
      const held = dragRef.current;
      if (!held) return;
      const seat = targetSeat(request);
      if (!seat) return;
      const token = (tokenRef.current += 1);
      setGateViews((current) => ({
        ...current,
        [request.id]: { phase: 'pending', gates: [], revealed: 0 },
      }));
      setCardMessages((current) => ({ ...current, [request.id]: '' }));
      setGateStatus(`Checking gates for ${request.ref} seat ${seat.position}…`);
      const promise = withTimeout(
        api.dryRun(seat.id, held.interpreterId).then((result) => result.gates),
      );
      pendingRef.current = {
        token,
        interpreterId: held.interpreterId,
        seatId: seat.id,
        requestId: request.id,
        promise,
      };
      promise.then(
        (gates) => {
          const pending = pendingRef.current;
          if (!pending || pending.token !== token) return;
          const current = dragRef.current;
          if (!current || current.interpreterId !== pending.interpreterId) return;
          if (current.targetRequestId !== request.id) return;
          pendingRef.current = null;
          revealGates(request.id, gates);
          setGateStatus(gateSummary(request.ref, seat.position, gates));
        },
        (error: unknown) => {
          const pending = pendingRef.current;
          if (!pending || pending.token !== token) return;
          pendingRef.current = null;
          setGateViews((current) => {
            const next = { ...current };
            delete next[request.id];
            return next;
          });
          if (error instanceof ApiCallError && error.failure.code === 'seat_taken') {
            setGateStatus(`Seat taken by ${error.failure.holder?.name ?? 'another coordinator'}.`);
          } else {
            setGateStatus(`Could not check gates for ${request.ref}. Nothing was offered.`);
          }
        },
      );
    },
    [revealGates],
  );

  const clearGates = (requestId: string): void => {
    clearStagger();
    pendingRef.current = null;
    setGateViews((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
  };

  const releaseThread = useCallback((phase: 'pinning' | 'recoiling', point?: { x: number; y: number }) => {
    setThreadPhase(phase);
    if (point) setPinPoint(point);
    const settle = phase === 'pinning' ? PIN_SETTLE_MS : RECOIL_SETTLE_MS;
    window.setTimeout(
      () => {
        dragRef.current = null;
        setDrag(null);
        setPinPoint(null);
        setThreadPhase('held');
      },
      reduced ? 1 : settle,
    );
  }, [reduced]);

  const focusChip = (interpreterId: string): void => {
    chipRefs.current[interpreterId]?.focus();
  };

  const commit = useCallback(
    async (request: RequestObject, gates: GateResult[]): Promise<void> => {
      const held = dragRef.current;
      if (!held) return;
      const seat = targetSeat(request);
      if (!seat) return;
      const interpreterId = held.interpreterId;
      const interpreterName = held.interpreterName;

      if (seat.status !== 'open') {
        const holder = seat.held_by?.name ?? 'another coordinator';
        setCardMessages((current) => ({ ...current, [request.id]: `Seat taken by ${holder}.` }));
        setBoardStatus(`Seat taken by ${holder}.`);
        releaseThread('recoiling');
        focusChip(interpreterId);
        return;
      }
      const failing = gates.find((gate) => !gate.pass);
      if (failing) {
        setCardMessages((current) => ({
          ...current,
          [request.id]: failing.reason ?? 'A dispatch gate failed.',
        }));
        setBoardStatus(`Not offered. ${failing.reason ?? ''}`.trim());
        releaseThread('recoiling');
        focusChip(interpreterId);
        return;
      }

      setBoardStatus(`Offering ${request.ref} seat ${seat.position} to ${interpreterName}…`);
      try {
        await api.pin(seat.id, interpreterId);
        const socket = seatRefs.current[seat.id]?.getBoundingClientRect();
        releaseThread(
          'pinning',
          socket ? { x: socket.left + socket.width / 2, y: socket.top + socket.height / 2 } : undefined,
        );
        setBoardStatus(`Offered ${request.ref} seat ${seat.position} to ${interpreterName}.`);
        setSelectedId(request.id);
        setRollingId(request.id);
        window.setTimeout(() => setRollingId(null), PIN_SETTLE_MS);
        await loadBoard();
      } catch (error) {
        const failure = error instanceof ApiCallError ? error.failure : null;
        let message = 'Could not send that offer.';
        if (failure?.code === 'gate_failed') message = `Not offered. ${failure.message}`;
        else if (failure?.code === 'seat_taken') {
          message = `Seat taken by ${failure.holder?.name ?? 'another coordinator'}.`;
        } else if (failure?.code === 'offer_window_closed') {
          message = 'Too late to send an offer for this seat.';
        }
        setCardMessages((current) => ({ ...current, [request.id]: message }));
        setBoardStatus(message);
        releaseThread('recoiling');
        await loadBoard();
      }
      focusChip(interpreterId);
    },
    [loadBoard, releaseThread],
  );

  /** Releasing over the target card waits for a pending answer, then pins or recoils. */
  const release = useCallback(
    async (request: RequestObject | null): Promise<void> => {
      const held = dragRef.current;
      if (!held) return;
      if (!request) {
        releaseThread('recoiling');
        focusChip(held.interpreterId);
        return;
      }
      const pending = pendingRef.current;
      if (pending && pending.requestId === request.id) {
        try {
          const gates = await pending.promise;
          settleGatesAtOnce(request.id);
          await commit(request, gates);
        } catch {
          setGateStatus(`Could not check gates for ${request.ref}. Nothing was offered.`);
          releaseThread('recoiling');
          focusChip(held.interpreterId);
        }
        return;
      }
      const view = gateViews[request.id];
      if (!view || view.phase !== 'resolved') {
        const seat = targetSeat(request);
        if (seat && seat.status !== 'open') {
          const holder = seat.held_by?.name ?? 'another coordinator';
          setCardMessages((current) => ({ ...current, [request.id]: `Seat taken by ${holder}.` }));
          setBoardStatus(`Seat taken by ${holder}.`);
        }
        releaseThread('recoiling');
        focusChip(held.interpreterId);
        return;
      }
      settleGatesAtOnce(request.id);
      await commit(request, view.gates);
    },
    [commit, gateViews, releaseThread],
  );

  const startDrag = (
    interpreter: BoardInterpreter,
    mode: 'pointer' | 'keyboard',
    point: { x: number; y: number },
  ): void => {
    const anchor = chipRefs.current[interpreter.id]?.getBoundingClientRect();
    const next: DragState = {
      interpreterId: interpreter.id,
      interpreterName: interpreter.name,
      anchor: anchor
        ? { x: anchor.right, y: anchor.top + anchor.height / 2 }
        : { x: point.x, y: point.y },
      pointer: point,
      mode,
      targetRequestId: null,
    };
    dragRef.current = next;
    setDrag(next);
    setThreadPhase('held');
    setCardMessages({});
  };

  useEffect(() => {
    if (!drag || drag.mode !== 'pointer') return;
    const onMove = (event: PointerEvent): void => {
      const held = dragRef.current;
      if (!held) return;
      const next = { ...held, pointer: { x: event.clientX, y: event.clientY } };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = (event: PointerEvent): void => {
      const held = dragRef.current;
      if (!held) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const card = element?.closest<HTMLElement>('article[data-request-id]');
      const requestId = card?.dataset.requestId ?? null;
      const request = requests.find((item) => item.id === requestId) ?? null;
      void release(request);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.touchAction = 'none';
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.touchAction = '';
      document.body.style.overflow = '';
    };
  }, [drag?.mode, drag !== null, release, requests]);

  const enterCard = (request: RequestObject): void => {
    const held = dragRef.current;
    if (!held) return;
    const next = { ...held, targetRequestId: request.id };
    dragRef.current = next;
    setDrag(next);
    startDryRun(request);
  };

  const leaveCard = (request: RequestObject): void => {
    const held = dragRef.current;
    if (!held || held.targetRequestId !== request.id) return;
    const next = { ...held, targetRequestId: null };
    dragRef.current = next;
    setDrag(next);
    clearGates(request.id);
    setGateStatus('');
  };

  const dayGroups = useMemo(() => {
    const groups: { key: string; heading: string; items: RequestObject[] }[] = [];
    for (const request of requests) {
      const key = agencyDateOf(new Date(request.start));
      const existing = groups.find((group) => group.key === key);
      if (existing) existing.items.push(request);
      else groups.push({ key, heading: dayHeading(request.start), items: [request] });
    }
    return groups;
  }, [requests]);

  const onCardKeyDown = (request: RequestObject, event: React.KeyboardEvent<HTMLElement>): void => {
    const held = dragRef.current;
    if (event.key === 'Escape' && held) {
      event.preventDefault();
      clearGates(request.id);
      releaseThread('recoiling');
      focusChip(held.interpreterId);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = requests.findIndex((item) => item.id === request.id);
      const nextIndex = event.key === 'ArrowDown' ? index + 1 : index - 1;
      const next = requests[nextIndex];
      if (!next) return;
      if (held) leaveCard(request);
      cardRefs.current[next.id]?.focus();
      if (held) enterCard(next);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!held) {
        setSelectedId(request.id);
        if (!wide) setTab('detail');
        return;
      }
      void release(request);
    }
  };

  const chip = (interpreter: BoardInterpreter): ReactElement => {
    const held = drag?.interpreterId === interpreter.id;
    return (
      <li key={interpreter.id}>
        <button
          type="button"
          className="chip"
          aria-label={interpreter.name}
          aria-pressed={held && drag?.mode === 'keyboard' ? true : undefined}
          ref={(element) => {
            chipRefs.current[interpreter.id] = element;
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            startDrag(interpreter, 'pointer', { x: event.clientX, y: event.clientY });
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            const rect = chipRefs.current[interpreter.id]?.getBoundingClientRect();
            startDrag(interpreter, 'keyboard', {
              x: rect ? rect.right : 0,
              y: rect ? rect.top + rect.height / 2 : 0,
            });
            const first = requests[0];
            if (first) {
              cardRefs.current[first.id]?.focus();
              enterCard(first);
            }
          }}
        >
          <span>{interpreter.name}</span>
          <span className="codes">
            {interpreter.credentials.length === 0
              ? 'No credentials'
              : interpreter.credentials.map((credential, index) => (
                  <span key={credential.id} className={credential.expired ? 'expired' : undefined}>
                    {credential.type}
                    {index < interpreter.credentials.length - 1 ? ' · ' : ''}
                  </span>
                ))}
          </span>
        </button>
      </li>
    );
  };

  const requestsPanel = (
    <section
      className="board-centre panel enter"
      role="region"
      aria-label="Requests, next 72 hours"
      id="requests-region"
    >
      {dayGroups.length === 0 ? <p>No requests start in the next 72 hours.</p> : null}
      {dayGroups.map((group, index) => (
        <div
          key={group.key}
          className={`day-group${firstLoad && !reduced ? ' enter' : ''}`}
          style={firstLoad && !reduced ? { animationDelay: `${index * 120}ms` } : undefined}
        >
          <h2 className="day-heading">{group.heading}</h2>
          {group.items.map((request) => (
            <RequestCard
              key={request.id}
              ref={(element) => {
                cardRefs.current[request.id] = element;
              }}
              request={request}
              selected={selectedId === request.id}
              hovered={drag?.targetRequestId === request.id}
              gateView={gateViews[request.id]}
              message={cardMessages[request.id] ?? ''}
              counterRolling={rollingId === request.id && !reduced}
              onSelect={() => {
                setSelectedId(request.id);
                if (!wide) setTab('detail');
              }}
              onPointerEnter={() => enterCard(request)}
              onPointerLeave={() => leaveCard(request)}
              onKeyDown={(event) => onCardKeyDown(request, event)}
              seatRef={(seatId, element) => {
                seatRefs.current[seatId] = element;
              }}
            />
          ))}
        </div>
      ))}
    </section>
  );

  const detailPanel = (
    <BoardDetail request={selected} preferred={preferred} gateView={selected ? gateViews[selected.id] : undefined} />
  );

  const threadTarget = pinPoint ?? drag?.pointer ?? { x: 0, y: 0 };

  return (
    <main>
      <div className="board-status-bar">
        <LiveRegion label="Gate results" message={gateStatus} />
        <LiveRegion label="Board status" message={boardStatus} />
      </div>
      {wide ? (
        <div className="board">
          <nav className="board-rail" aria-label="Interpreter rail">
            <ul className="plain" aria-label="Interpreters">
              {(board?.interpreters ?? []).map(chip)}
            </ul>
          </nav>
          {requestsPanel}
          {detailPanel}
        </div>
      ) : (
        <div className="board">
          <div className="tabs" role="tablist" aria-label="Board views">
            <button
              type="button"
              role="tab"
              id="tab-requests"
              aria-selected={tab === 'requests'}
              aria-controls="panel-requests"
              tabIndex={tab === 'requests' ? 0 : -1}
              onClick={() => setTab('requests')}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  setTab('detail');
                }
              }}
            >
              Requests
            </button>
            <button
              type="button"
              role="tab"
              id="tab-detail"
              aria-selected={tab === 'detail'}
              aria-controls="panel-detail"
              tabIndex={tab === 'detail' ? 0 : -1}
              onClick={() => setTab('detail')}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  setTab('requests');
                }
              }}
            >
              Detail
            </button>
          </div>
          <div
            id="panel-requests"
            role="tabpanel"
            aria-labelledby="tab-requests"
            hidden={tab !== 'requests'}
          >
            {requestsPanel}
          </div>
          <div
            id="panel-detail"
            role="tabpanel"
            aria-labelledby="tab-detail"
            hidden={tab !== 'detail'}
          >
            {detailPanel}
          </div>
          <nav className="strip" aria-label="Interpreter rail">
            <ul className="plain" aria-label="Interpreters">
              {(board?.interpreters ?? []).map(chip)}
            </ul>
          </nav>
        </div>
      )}
      {drag ? (
        <MatchThread
          from={drag.anchor}
          to={threadTarget}
          phase={threadPhase}
          straight={reduced}
        />
      ) : null}
    </main>
  );
}
