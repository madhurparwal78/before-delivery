import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiFailure, api } from '../lib/api.js';
import { useStageScene, useToasts } from '../lib/app-context.js';
import { useReducedMotion } from '../lib/typing.js';
import { RollingAmount } from '../components/ui.js';
import type { CommissionShape, QuoteShape } from '../lib/shapes.js';
import { formatAmount } from '../../shared/money.js';
import * as copy from '../../shared/copy.js';
import {
  ADDON_LABELS,
  ADDON_ORDER,
  PIECES,
  SIZE_LABELS,
  type AddOn,
  type PieceKind,
  type SizeOption,
} from '../../shared/seed.js';
import {
  GRID_STEP_M,
  ROTATION_STEP_DEG,
  formatMetres,
  snapMetres,
  snapRotation,
  type LayoutItem,
} from '../../shared/placement.js';

const SIZES: SizeOption[] = ['compact', 'standard', 'grand'];
const FLING_SPEED_M_PER_S = 0.3;
const FLING_DECAY = 0.92;
const FLING_STOP_M_PER_S = 0.05;

interface QuoteAmounts {
  lines: { label: string; amountCents: number }[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function Configure(): JSX.Element {
  const { commissionId = '' } = useParams();
  const reducedMotion = useReducedMotion();
  const { notify } = useToasts();

  const [commission, setCommission] = useState<CommissionShape | null>(null);
  const [items, setItems] = useState<LayoutItem[]>([]);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [placement, setPlacement] = useState('');
  const [quoteText, setQuoteText] = useState('');
  const [size, setSize] = useState<SizeOption>('compact');
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [preview, setPreview] = useState<QuoteAmounts | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const savedItems = useRef<LayoutItem[]>([]);
  const latestQuote = useRef(0);
  const roomRef = useRef<HTMLDivElement | null>(null);

  useStageScene({
    scene: 'configurator',
    silhouette: commission?.installationType ?? 'none',
    roomWidthM: commission?.room.widthM ?? null,
    roomDepthM: commission?.room.depthM ?? null,
  });

  const adopt = useCallback((loaded: CommissionShape) => {
    setCommission(loaded);
    setItems(loaded.layout.items);
    savedItems.current = loaded.layout.items;
    setVersion(loaded.layout.version);
    setSize(loaded.options.size);
    setAddOns(loaded.options.addOns);
    if (loaded.quote) {
      setPreview({
        lines: loaded.quote.lines,
        subtotalCents: loaded.quote.subtotalCents,
        taxCents: loaded.quote.taxCents,
        totalCents: loaded.quote.totalCents,
      });
    }
  }, []);

  useEffect(() => {
    void api
      .get<CommissionShape>(`/api/commissions/${commissionId}`)
      .then(adopt)
      .catch(() => undefined);
  }, [adopt, commissionId]);

  // Changing size or extras previews the quote from the latest reply only.
  useEffect(() => {
    if (!commission) return undefined;
    const timer = setTimeout(() => {
      const ticket = latestQuote.current + 1;
      latestQuote.current = ticket;
      void api
        .post<QuoteAmounts>(`/api/commissions/${commissionId}/quote-preview`, { size, addOns })
        .then((result) => {
          if (ticket !== latestQuote.current) return;
          setPreview(result);
          setQuoteText(copy.quoteUpdated(formatAmount(result.totalCents)));
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [addOns, commission, commissionId, size]);

  const required = commission?.requiredPieces ?? [];
  const unplaced = required.filter((kind) => !items.some((item) => item.kind === kind));

  const saveLayout = useCallback(
    async (next: LayoutItem[], announceIndex: number | null): Promise<void> => {
      try {
        const result = await api.put<{ version: number; items: LayoutItem[] }>(
          `/api/commissions/${commissionId}/layout`,
          { version, items: next },
        );
        setVersion(result.version);
        setItems(result.items);
        savedItems.current = result.items;
        if (announceIndex !== null) {
          const item = result.items[announceIndex];
          if (item) {
            setPlacement(
              copy.piecePlaced(
                PIECES[item.kind].label,
                formatMetres(item.x),
                formatMetres(item.y),
                item.rotationDeg,
              ),
            );
          }
        }
      } catch (error) {
        if (error instanceof ApiFailure) {
          if (error.status === 412) {
            setPlacement(copy.LAYOUT_VERSION_CONFLICT);
            const fresh = await api
              .get<CommissionShape>(`/api/commissions/${commissionId}`)
              .catch(() => null);
            if (fresh) adopt(fresh);
            return;
          }
          const message = Object.values(error.fieldErrors)[0] ?? error.publicMessage;
          if (message) setPlacement(message);
          // A refused drop springs the piece back to its last saved position.
          setItems(savedItems.current);
        }
      }
    },
    [adopt, commissionId, version],
  );

  const place = (kind: PieceKind): void => {
    if (!commission) return;
    const next: LayoutItem[] = [
      ...items,
      {
        kind,
        x: snapMetres(commission.room.widthM / 2),
        y: snapMetres(commission.room.depthM / 2),
        rotationDeg: 0,
      },
    ];
    setItems(next);
    setSelected(next.length - 1);
    void saveLayout(next, next.length - 1);
  };

  const nudge = (index: number, dx: number, dy: number, dr: number): void => {
    setItems((current) =>
      current.map((item, i) =>
        i === index
          ? {
              ...item,
              x: snapMetres(item.x + dx),
              y: snapMetres(item.y + dy),
              rotationDeg: snapRotation(item.rotationDeg + dr),
            }
          : item,
      ),
    );
  };

  // While focus is anywhere inside the room the published keys move the piece.
  const onRoomKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (selected === null) return;
    const far = event.shiftKey ? 1 : GRID_STEP_M;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        nudge(selected, far, 0, 0);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        nudge(selected, -far, 0, 0);
        return;
      case 'ArrowUp':
        // Up moves the piece away from the front wall.
        event.preventDefault();
        nudge(selected, 0, far, 0);
        return;
      case 'ArrowDown':
        event.preventDefault();
        nudge(selected, 0, -far, 0);
        return;
      case 'r':
      case 'R':
        event.preventDefault();
        nudge(selected, 0, 0, event.shiftKey ? -ROTATION_STEP_DEG : ROTATION_STEP_DEG);
        return;
      case 'Enter':
        event.preventDefault();
        void saveLayout(items, selected);
        return;
      case 'Escape':
        event.preventDefault();
        setItems(savedItems.current);
        return;
      default:
    }
  };

  const toMetres = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const room = roomRef.current;
      if (!room || !commission) return null;
      const box = room.getBoundingClientRect();
      const fx = (clientX - box.left) / box.width;
      const fy = (clientY - box.top) / box.height;
      return {
        x: fx * commission.room.widthM,
        // The floor runs away from the front wall as the pointer moves up.
        y: (1 - fy) * commission.room.depthM,
      };
    },
    [commission],
  );

  const drag = useRef<{
    index: number;
    lastAt: number;
    lastX: number;
    lastY: number;
    vx: number;
    vy: number;
  } | null>(null);

  const onPiecePointerDown = (index: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const point = toMetres(event.clientX, event.clientY);
    if (!point) return;
    setSelected(index);
    drag.current = {
      index,
      lastAt: performance.now(),
      lastX: point.x,
      lastY: point.y,
      vx: 0,
      vy: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPiecePointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const state = drag.current;
    if (!state) return;
    const point = toMetres(event.clientX, event.clientY);
    if (!point) return;
    const now = performance.now();
    const dt = Math.max(0.001, (now - state.lastAt) / 1000);
    state.vx = (point.x - state.lastX) / dt;
    state.vy = (point.y - state.lastY) / dt;
    state.lastAt = now;
    state.lastX = point.x;
    state.lastY = point.y;
    setItems((current) =>
      current.map((item, i) => (i === state.index ? { ...item, x: point.x, y: point.y } : item)),
    );
  };

  /**
   * A release above the fling threshold glides on, losing 8% of its speed every
   * sixtieth of a second, then snaps to the quarter-metre grid and drops.
   */
  const onPiecePointerUp = (): void => {
    const state = drag.current;
    drag.current = null;
    if (!state || !commission) return;
    const index = state.index;
    const speed = Math.hypot(state.vx, state.vy);

    const settle = (x: number, y: number): void => {
      const snappedX = snapMetres(x);
      const snappedY = snapMetres(y);
      setItems((current) => {
        const next = current.map((item, i) =>
          i === index ? { ...item, x: snappedX, y: snappedY } : item,
        );
        void saveLayout(next, index);
        return next;
      });
    };

    const current = items[index];
    if (!current) return;
    if (reducedMotion || speed <= FLING_SPEED_M_PER_S) {
      settle(current.x, current.y);
      return;
    }

    let x = current.x;
    let y = current.y;
    let vx = state.vx;
    let vy = state.vy;
    const glide = (): void => {
      vx *= FLING_DECAY;
      vy *= FLING_DECAY;
      x = Math.max(0, Math.min(commission.room.widthM, x + vx / 60));
      y = Math.max(0, Math.min(commission.room.depthM, y + vy / 60));
      const atWall =
        x <= 0 || y <= 0 || x >= commission.room.widthM || y >= commission.room.depthM;
      setItems((list) => list.map((item, i) => (i === index ? { ...item, x, y } : item)));
      if (Math.hypot(vx, vy) < FLING_STOP_M_PER_S || atWall) {
        settle(x, y);
        return;
      }
      requestAnimationFrame(glide);
    };
    requestAnimationFrame(glide);
  };

  const saveQuote = async (): Promise<void> => {
    try {
      const result = await api.put<{ quote: QuoteShape | null }>(
        `/api/commissions/${commissionId}/options`,
        { size, addOns },
      );
      if (result.quote) {
        setPreview({
          lines: result.quote.lines,
          subtotalCents: result.quote.subtotalCents,
          taxCents: result.quote.taxCents,
          totalCents: result.quote.totalCents,
        });
        setQuoteText(copy.quoteUpdated(formatAmount(result.quote.totalCents)));
      }
      const fresh = await api.get<CommissionShape>(`/api/commissions/${commissionId}`);
      adopt(fresh);
    } catch (error) {
      if (error instanceof ApiFailure) notify(error.publicMessage ?? copy.TRANSITION_UNAVAILABLE);
    }
  };

  const inspector = useMemo(
    () => (
      <div className="inspector" role="region" aria-label="Inspector">
        <section>
          <h3>Pieces to place</h3>
          <ul className="list" aria-label="Pieces to place">
            {unplaced.map((kind) => (
              <li key={kind}>
                <button type="button" onClick={() => place(kind)}>
                  Place {PIECES[kind].label}
                </button>
              </li>
            ))}
            {unplaced.length === 0 ? <li className="muted">Every piece is placed.</li> : null}
          </ul>
        </section>

        <section>
          <h3>Size</h3>
          <div role="radiogroup" aria-label="Size" className="chip-grid few">
            {SIZES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={size === option}
                className="chip"
                onClick={() => setSize(option)}
              >
                <span className="box" aria-hidden="true">
                  {size === option ? '✓' : ''}
                </span>
                <span className="label">{SIZE_LABELS[option]}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Extras</h3>
          <div role="group" aria-label="Extras" className="chip-grid few">
            {ADDON_ORDER.map((addOn) => (
              <button
                key={addOn}
                type="button"
                role="checkbox"
                aria-checked={addOns.includes(addOn)}
                className="chip"
                onClick={() =>
                  setAddOns((current) =>
                    current.includes(addOn)
                      ? current.filter((item) => item !== addOn)
                      : [...current, addOn],
                  )
                }
              >
                <span className="box" aria-hidden="true">
                  {addOns.includes(addOn) ? '✓' : ''}
                </span>
                <span className="label">{ADDON_LABELS[addOn]}</span>
              </button>
            ))}
          </div>
        </section>

        <section role="region" aria-label="Quote">
          <h3>Quote</h3>
          <ul className="list">
            {(preview?.lines ?? []).map((line) => (
              <li className="spread" key={line.label}>
                <span>{line.label}</span>
                <span className="amount">{formatAmount(line.amountCents)}</span>
              </li>
            ))}
          </ul>
          <p className="spread">
            <strong>Total</strong>
            <strong>
              <RollingAmount
                amount={formatAmount(preview?.totalCents ?? 0)}
                reducedMotion={reducedMotion}
              />
            </strong>
          </p>
          <div role="status" aria-label="Quote total" aria-live="polite" className="muted">
            {quoteText}
          </div>
          <button type="button" className="primary" onClick={() => void saveQuote()}>
            Save quote
          </button>
        </section>

        <div role="status" aria-label="Placement status" aria-live="polite" className="muted">
          {placement}
        </div>
      </div>
    ),
    // The inspector redraws whenever anything it shows changes.
    [addOns, placement, preview, quoteText, reducedMotion, size, unplaced.join(','), items],
  );

  if (!commission) return <main className="column" />;

  return (
    <main className="configurator">
      <div className="scene">
        <div
          ref={roomRef}
          className="room-region"
          role="region"
          aria-label="Room"
          tabIndex={-1}
          onKeyDown={onRoomKeyDown}
          style={{ position: 'relative', width: '100%', height: '100%' }}
        >
          {items.map((item, index) => (
            <button
              key={`${item.kind}-${index}`}
              type="button"
              className="piece-button"
              aria-pressed={selected === index}
              style={{
                left: `${(item.x / commission.room.widthM) * 100}%`,
                top: `${(1 - item.y / commission.room.depthM) * 100}%`,
              }}
              onFocus={() => setSelected(index)}
              onClick={() => setSelected(index)}
              onPointerDown={onPiecePointerDown(index)}
              onPointerMove={onPiecePointerMove}
              onPointerUp={onPiecePointerUp}
            >
              {`${PIECES[item.kind].label} at ${formatMetres(item.x)} m, ${formatMetres(
                item.y,
              )} m, turned ${item.rotationDeg}°`}
            </button>
          ))}
          <p className="key-chord" style={{ position: 'absolute', bottom: 8, left: 8 }}>
            {copy.KEY_CHORD_ROOM}
          </p>
        </div>
      </div>

      <div className="inspector-wrap">
        <button
          type="button"
          className="chip-chrome sheet-handle"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((open) => !open)}
        >
          {sheetOpen ? 'Hide inspector' : 'Show inspector'}
        </button>
        <InspectorHolder open={sheetOpen} onEscape={() => setSheetOpen(false)}>
          {inspector}
        </InspectorHolder>
      </div>
    </main>
  );
}

/**
 * From 768 pixels up the inspector is always present. Below that it is a bottom
 * sheet, and when closed nothing inside it can be seen or reached.
 */
function InspectorHolder({
  open,
  onEscape,
  children,
}: {
  open: boolean;
  onEscape: () => void;
  children: React.ReactNode;
}): JSX.Element | null {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = (): void => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // Escape closes the sheet wherever focus happens to be.
  useEffect(() => {
    if (!narrow || !open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [narrow, onEscape, open]);

  if (!narrow) return <>{children}</>;
  if (!open) return null;
  return <div className="inspector-sheet">{children}</div>;
}
