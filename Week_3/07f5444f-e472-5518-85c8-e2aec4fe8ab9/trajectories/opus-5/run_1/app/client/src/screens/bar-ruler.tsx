import { useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Undo2 } from 'lucide-react';
import type { Cut, WorkDetail } from '../../../shared/api.js';
import { EN_DASH } from '../../../shared/format.js';
import { Modal } from '../ui.js';

export interface SpliceAnimation {
  direction: 'cut' | 'restore';
  from_bar: number;
  to_bar: number;
  phase: 'hatch' | 'collapse' | 'count';
  displayedSeconds: number;
}

const SPLICE_MARK_WIDTH = 4;
const SLIDE_MS = 330;
const HATCH_MS = 100;

interface Geometry {
  spacing: number;
  width: number;
  xOfBar: number[];
  marks: { cut: Cut; x: number }[];
}

function buildGeometry(work: WorkDetail, paneWidth: number): Geometry {
  const spacing = work.bars > 0 ? paneWidth / work.bars : 0;
  const xOfBar: number[] = new Array<number>(work.bars + 1).fill(-1);
  const marks: { cut: Cut; x: number }[] = [];
  let x = 0;
  let bar = 1;
  while (bar <= work.bars) {
    const cut = work.cuts.find((candidate) => bar >= candidate.from_bar && bar <= candidate.to_bar);
    if (cut) {
      marks.push({ cut, x });
      x += SPLICE_MARK_WIDTH;
      bar = cut.to_bar + 1;
      continue;
    }
    xOfBar[bar] = x;
    x += spacing;
    bar += 1;
  }
  return { spacing, width: x, xOfBar, marks };
}

function labelInterval(viewportWidth: number): number {
  if (viewportWidth >= 1280) return 10;
  if (viewportWidth >= 768) return 25;
  return 50;
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  useEffect(() => {
    const listener = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, []);
  return width;
}

function isCutBar(work: WorkDetail, bar: number): boolean {
  return work.cuts.some((cut) => bar >= cut.from_bar && bar <= cut.to_bar);
}

function firstUncutBar(work: WorkDetail): number {
  for (let bar = 1; bar <= work.bars; bar += 1) if (!isCutBar(work, bar)) return bar;
  return 1;
}

function lastUncutBar(work: WorkDetail): number {
  for (let bar = work.bars; bar >= 1; bar -= 1) if (!isCutBar(work, bar)) return bar;
  return work.bars;
}

/** The caret skips over the bars inside existing cuts. */
function stepCaret(work: WorkDetail, bar: number, direction: 1 | -1): number {
  let next = bar + direction;
  while (next >= 1 && next <= work.bars && isCutBar(work, next)) next += direction;
  return next < 1 || next > work.bars ? bar : next;
}

/** A selection never crosses into a cut: it stops at the last bar before it. */
function extendSelection(work: WorkDetail, bar: number, direction: 1 | -1): number {
  const next = bar + direction;
  return next < 1 || next > work.bars || isCutBar(work, next) ? bar : next;
}

export interface BarRulerProps {
  work: WorkDetail;
  animation: SpliceAnimation | null;
  statusLines: string[];
  mayEdit: boolean;
  undoableCut: Cut | null;
  onCommitCut: (fromBar: number, toBar: number, returnFocusToRuler: boolean) => void;
  onRestoreCut: (cut: Cut) => void;
  rulerFocusRef: React.MutableRefObject<(() => void) | null>;
}

export function BarRuler({
  work,
  animation,
  statusLines,
  mayEdit,
  undoableCut,
  onCommitCut,
  onRestoreCut,
  rulerFocusRef,
}: BarRulerProps): JSX.Element {
  const [caret, setCaret] = useState(() => firstUncutBar(work));
  const [anchor, setAnchor] = useState<number | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  const [restoring, setRestoring] = useState<Cut | null>(null);
  const dragging = useRef(false);
  const frame = useRef<HTMLDivElement | null>(null);
  const slider = useRef<HTMLDivElement | null>(null);
  const viewportWidth = useViewportWidth();

  useEffect(() => {
    rulerFocusRef.current = () => slider.current?.focus();
    return () => {
      rulerFocusRef.current = null;
    };
  }, [rulerFocusRef]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setPaneWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setPaneWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (caret > work.bars) {
      setCaret(lastUncutBar(work));
      return;
    }
    if (isCutBar(work, caret)) {
      const next = stepCaret(work, caret, 1);
      setCaret(next === caret ? firstUncutBar(work) : next);
    }
    if (anchor !== null && (anchor > work.bars || isCutBar(work, anchor))) setAnchor(null);
  }, [work, caret, anchor]);

  const geometry = useMemo(() => buildGeometry(work, paneWidth), [work, paneWidth]);
  const interval = labelInterval(viewportWidth);
  const selection = anchor === null ? null : { from: Math.min(anchor, caret), to: Math.max(anchor, caret) };
  const valueText = selection ? `Bars ${selection.from}${EN_DASH}${selection.to} selected` : `Bar ${caret}`;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const key = event.key;
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      event.preventDefault();
      const direction = key === 'ArrowRight' ? 1 : -1;
      if (event.shiftKey) {
        setAnchor(anchor ?? caret);
        setCaret(extendSelection(work, caret, direction));
        return;
      }
      setAnchor(null);
      setCaret(stepCaret(work, caret, direction));
      return;
    }
    if (key === 'Home' || key === 'End') {
      event.preventDefault();
      setAnchor(null);
      setCaret(key === 'Home' ? firstUncutBar(work) : lastUncutBar(work));
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      setAnchor(null);
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      if (selection && mayEdit) {
        onCommitCut(selection.from, selection.to, false);
        setAnchor(null);
      }
    }
  }

  function barAtPoint(clientX: number): number | null {
    const element = frame.current;
    if (!element) return null;
    const offset = clientX - element.getBoundingClientRect().left;
    let closest: number | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let bar = 1; bar <= work.bars; bar += 1) {
      const x = geometry.xOfBar[bar];
      if (x === undefined || x < 0) continue;
      const distance = Math.abs(x + geometry.spacing / 2 - offset);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = bar;
      }
    }
    return closest;
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.target instanceof HTMLElement && event.target.closest('button')) return;
    const bar = barAtPoint(event.clientX);
    if (bar === null) return;
    slider.current?.focus();
    setAnchor(bar);
    setCaret(bar);
    dragging.current = true;
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging.current || anchor === null) return;
    const bar = barAtPoint(event.clientX);
    if (bar === null || bar === caret) return;
    const direction = bar >= anchor ? 1 : -1;
    let limit = anchor;
    while (limit !== bar) {
      const next = extendSelection(work, limit, direction);
      if (next === limit) break;
      limit = next;
    }
    setCaret(limit);
  }

  function onPointerUp(): void {
    dragging.current = false;
    if (anchor !== null && anchor === caret) setAnchor(null);
  }

  const spanWidth = animation
    ? (animation.to_bar - animation.from_bar + 1) * geometry.spacing
    : 0;
  const removedWidth = Math.max(0, spanWidth - SPLICE_MARK_WIDTH);
  const sliding = animation !== null && animation.phase !== 'hatch';
  const slideBy =
    animation === null ? 0 : !sliding ? 0 : animation.direction === 'cut' ? -removedWidth : removedWidth;
  const hatchLeft = animation
    ? animation.direction === 'cut'
      ? (geometry.xOfBar[animation.from_bar] ?? 0)
      : (geometry.marks.find((mark) => mark.cut.from_bar === animation.from_bar)?.x ?? 0)
    : 0;
  const hatchWidth =
    animation === null
      ? 0
      : animation.direction === 'cut'
        ? animation.phase === 'hatch'
          ? spanWidth
          : SPLICE_MARK_WIDTH
        : animation.phase === 'hatch'
          ? SPLICE_MARK_WIDTH
          : spanWidth;

  const inAfterGroup = (bar: number): boolean => animation !== null && bar > animation.to_bar;

  const before: JSX.Element[] = [];
  const after: JSX.Element[] = [];
  const place = (bar: number, element: JSX.Element): void => {
    (inAfterGroup(bar) ? after : before).push(element);
  };

  for (let bar = 1; bar <= work.bars; bar += 1) {
    const x = geometry.xOfBar[bar];
    if (x === undefined || x < 0) continue;
    const labelled = bar === 1 || bar % interval === 0;
    place(
      bar,
      <span key={`tick-${bar}`} className={`tick${labelled ? ' tick-labelled' : ''}`} style={{ left: `${x}px` }} />,
    );
    if (labelled) {
      place(
        bar,
        <span key={`bar-number-${bar}`} className="bar-number mono" style={{ left: `${x}px` }}>
          {bar}
        </span>,
      );
    }
  }

  for (const letter of work.rehearsal_letters) {
    const x = geometry.xOfBar[letter.bar];
    if (letter.cut || x === undefined || x < 0) continue;
    place(
      letter.bar,
      <span key={`letter-${letter.letter}`} className="rehearsal-letter" style={{ left: `${x}px` }}>
        {letter.letter}
      </span>,
    );
  }

  for (const mark of geometry.marks) {
    const hiddenByAnimation = animation?.direction === 'restore' && animation.from_bar === mark.cut.from_bar;
    if (hiddenByAnimation) continue;
    place(
      mark.cut.from_bar,
      <span key={`mark-${mark.cut.id}`} className="splice" style={{ left: `${mark.x}px` }}>
        <span className="splice-mark" />
        <span className="splice-label mono">
          vi{EN_DASH}de {mark.cut.from_bar}
          {EN_DASH}
          {mark.cut.to_bar}
        </span>
        {mayEdit ? (
          <button
            type="button"
            className="splice-button"
            onClick={() => setRestoring(mark.cut)}
          >
            <span className="visually-hidden">
              Restore bars {mark.cut.from_bar}
              {EN_DASH}
              {mark.cut.to_bar}
            </span>
          </button>
        ) : null}
      </span>,
    );
  }

  const selectionLeft = selection ? (geometry.xOfBar[selection.from] ?? 0) : 0;
  const selectionRight = selection
    ? (geometry.xOfBar[selection.to] ?? 0) + geometry.spacing
    : 0;

  return (
    <section className="ruler-pane" aria-labelledby="ruler-heading">
      <div className="ruler-toolbar">
        <h2 id="ruler-heading" className="pane-heading">
          {work.title}
        </h2>
        <span className="mono ruler-figures">
          {work.bars} bars · {work.running_time}
        </span>
        <button
          type="button"
          className="primary"
          disabled={selection === null || !mayEdit}
          onClick={() => {
            if (!selection) return;
            onCommitCut(selection.from, selection.to, true);
            setAnchor(null);
          }}
        >
          <Scissors className="icon" aria-hidden="true" focusable="false" />
          {selection ? `Mark cut ${selection.from}${EN_DASH}${selection.to}` : 'Mark cut'}
        </button>
        <button
          type="button"
          disabled={undoableCut === null || !mayEdit}
          onClick={() => {
            if (undoableCut) onRestoreCut(undoableCut);
          }}
        >
          <Undo2 className="icon" aria-hidden="true" focusable="false" />
          Undo cut
        </button>
      </div>

      <div className="ruler-frame" ref={frame}>
        <div
          className="ruler"
          role="slider"
          tabIndex={0}
          aria-label="Bar ruler"
          aria-valuemin={1}
          aria-valuemax={work.bars}
          aria-valuenow={caret}
          aria-valuetext={valueText}
          ref={slider}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ width: `${Math.max(geometry.width, 1)}px` }}
        >
          <div className="ruler-group">{before}</div>
          <div
            className="ruler-group"
            style={{
              transform: `translateX(${slideBy}px)`,
              transition: animation && sliding ? `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.1, 1)` : 'none',
            }}
          >
            {after}
          </div>
          {selection ? (
            <span
              className="selection"
              style={{ left: `${selectionLeft}px`, width: `${Math.max(selectionRight - selectionLeft, 2)}px` }}
            />
          ) : null}
          <span className="caret" style={{ left: `${geometry.xOfBar[caret] ?? 0}px` }} />
          {animation ? (
            <span
              className={`hatch${animation.direction === 'cut' && animation.phase === 'hatch' ? ' hatch-sweep' : ''}`}
              style={{
                left: `${hatchLeft}px`,
                width: `${hatchWidth}px`,
                animationDuration: `${HATCH_MS}ms`,
                transition:
                  animation.phase === 'hatch' ? 'none' : `width ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.1, 1)`,
              }}
            />
          ) : null}
        </div>
      </div>

      <p className="ruler-status" role="status" aria-label="Ruler status">
        {statusLines.map((line, index) => (
          <span key={`${index}-${line}`} className="status-line">
            {line}
          </span>
        ))}
      </p>

      {restoring === null ? null : (
        <Modal
          name={`Restore bars ${restoring.from_bar}${EN_DASH}${restoring.to_bar}`}
          onClose={() => setRestoring(null)}
        >
          <h2>
            Restore bars {restoring.from_bar}
            {EN_DASH}
            {restoring.to_bar}
          </h2>
          <p>Restoring puts these bars back and clears the marks recorded against the cut.</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                const cut = restoring;
                setRestoring(null);
                onRestoreCut(cut);
                slider.current?.focus();
              }}
            >
              Restore bars
            </button>
            <button type="button" onClick={() => setRestoring(null)}>
              Keep cut
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
