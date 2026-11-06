// The daily timeline: one notebook-spine column per day with its heat band, scrolled by drag with coast and snap.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import '../styles/board.css';
import { api, get, NetworkError } from '../api.ts';
import { announce, plural, showAlert } from '../feedback.ts';
import { reducedMotion } from '../motion.ts';
import { useSession } from '../session.ts';
import { useSync } from '../sync.ts';
import type { TimelineJson } from '../types.ts';
import { coastDone, coastOffset, coastVelocity, quireEase, snapOffset, TIMELINE_SNAP_MS, type DragSample } from '../../shared/motion.ts';
import { dateHeading } from '../../shared/time.ts';
import { heatColor, HEAT_BAND_PX, rgbCss } from '../../shared/tokens.ts';

type Day = TimelineJson['days'][number];

const DRAG_START_PX = 4;
const REFUSED = "That block couldn't be moved.";
/** Pointer samples older than this are no longer needed for the release velocity. */
const SAMPLE_KEEP_MS = 1000;

interface ScrollDrag { pointerId: number; sx: number; start: number; samples: DragSample[]; moved: boolean }
interface BlockDrag { pointerId: number; blockId: string; date: string; sx: number; sy: number; active: boolean; el: HTMLElement | null }

export function TimelinePage() {
  const { theme } = useSession();
  const [timeline, setTimelineState] = useState<TimelineJson | null>(null);
  const timelineRef = useRef<TimelineJson | null>(null);
  const regionRef = useRef<HTMLElement | null>(null);
  const dayEls = useRef(new Map<string, HTMLLIElement>());
  const handleEls = useRef(new Map<string, HTMLButtonElement>());
  const opened = useRef(false);
  const focusBlock = useRef<string | null>(null);
  const scrollDrag = useRef<ScrollDrag | null>(null);
  const blockDrag = useRef<BlockDrag | null>(null);
  const frame = useRef<number | null>(null);
  const fetchSeq = useRef(0);
  const [dropDate, setDropDate] = useState<string | null>(null);

  const setTimeline = useCallback((next: TimelineJson) => {
    timelineRef.current = next;
    setTimelineState(next);
  }, []);

  const load = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const r = await get<TimelineJson>('/api/timeline');
      if (seq === fetchSeq.current && r.status === 200) setTimeline(r.data);
    } catch {
      // offline: the next live event or reset refetches
    }
  }, [setTimeline]);
  useEffect(() => {
    void load();
  }, [load]);
  useSync((event) => {
    if (event === 'block.saved' || event === 'block.removed' || event === 'object.saved' || event === 'object.removed' || event === 'sync.reset') void load();
  });

  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region || !timeline) return;
    if (!opened.current) {
      opened.current = true;
      region.scrollLeft = region.scrollWidth - region.clientWidth;
    }
    const id = focusBlock.current;
    const handle = id ? handleEls.current.get(id) : undefined;
    if (handle) {
      focusBlock.current = null;
      handle.focus({ preventScroll: true });
      handle.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [timeline]);

  // Scrolling: one for one under the pointer, then coast and snap on the page's animation clock.
  const maxOffset = (): number => {
    const r = regionRef.current;
    return r ? Math.max(0, r.scrollWidth - r.clientWidth) : 0;
  };
  const clampOffset = (v: number): number => Math.min(maxOffset(), Math.max(0, v));
  const setOffset = (v: number): void => {
    if (regionRef.current) regionRef.current.scrollLeft = v;
  };
  const stopMotion = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(() => stopMotion, []);

  const snapFrom = (from: number): void => {
    const to = clampOffset(snapOffset(from));
    if (reducedMotion() || from === to) {
      setOffset(to);
      frame.current = null;
      return;
    }
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / TIMELINE_SNAP_MS);
      setOffset(clampOffset(from + (to - from) * quireEase(p)));
      frame.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
  };
  const coast = (release: number, v0: number): void => {
    if (reducedMotion()) {
      snapFrom(release);
      return;
    }
    const t0 = performance.now();
    const step = () => {
      const t = performance.now() - t0;
      const offset = clampOffset(coastOffset(release, v0, t));
      if (coastDone(v0, t)) {
        snapFrom(offset);
        return;
      }
      setOffset(offset);
      frame.current = requestAnimationFrame(step);
    };
    if (coastDone(v0, 0)) snapFrom(release);
    else frame.current = requestAnimationFrame(step);
  };

  const onRegionPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || scrollDrag.current) return;
    if ((e.target as Element).closest('button')) return;
    stopMotion();
    const start = e.currentTarget.scrollLeft;
    scrollDrag.current = { pointerId: e.pointerId, sx: e.clientX, start, samples: [{ t: performance.now(), offset: start }], moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onRegionPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = scrollDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const offset = clampOffset(d.start - (e.clientX - d.sx));
    if (e.clientX !== d.sx) d.moved = true;
    setOffset(offset);
    const t = performance.now();
    d.samples.push({ t, offset });
    while (d.samples.length > 2 && t - (d.samples[1]?.t ?? t) > SAMPLE_KEEP_MS) d.samples.shift();
  };
  const onRegionPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = scrollDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    scrollDrag.current = null;
    if (!d.moved) return;
    const last = d.samples[d.samples.length - 1];
    coast(last ? last.offset : e.currentTarget.scrollLeft, coastVelocity(d.samples));
  };

  // Moving a block to the end of another day's note.
  const moveBlock = async (blockId: string, fromDate: string, toDate: string): Promise<void> => {
    const tl = timelineRef.current;
    const target = tl?.days.find((d) => d.date === toDate);
    if (!tl || !target?.object_id || fromDate === toDate) return;
    let ok = false;
    try {
      const r = await api('POST', `/api/blocks/${blockId}/move`, { object_id: target.object_id, after_block_id: null });
      ok = r.status >= 200 && r.status < 300;
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
    }
    if (!ok) {
      showAlert(REFUSED);
      return;
    }
    const now = timelineRef.current ?? tl;
    const block = now.days.find((d) => d.date === fromDate)?.blocks.find((b) => b.id === blockId);
    if (block) {
      setTimeline({
        ...now,
        days: now.days.map((d): Day => {
          if (d.date === fromDate) return { ...d, block_count: Math.max(0, d.block_count - 1), blocks: d.blocks.filter((b) => b.id !== blockId) };
          if (d.date === toDate) return { ...d, block_count: d.block_count + 1, blocks: [...d.blocks, block] };
          return d;
        }),
      });
    }
    focusBlock.current = blockId;
    announce(`Moved block to ${dateHeading(toDate)}.`);
    void load();
  };

  const onHandleKey = (blockId: string, date: string) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const days = timelineRef.current?.days ?? [];
    const i = days.findIndex((d) => d.date === date);
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    for (let j = i + step; i >= 0 && j >= 0 && j < days.length; j += step) {
      const d = days[j];
      if (d?.object_id) {
        void moveBlock(blockId, date, d.date);
        return;
      }
    }
  };

  const dayAt = (x: number): Day | undefined => {
    for (const d of timelineRef.current?.days ?? []) {
      const r = dayEls.current.get(d.date)?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right) return d;
    }
    return undefined;
  };
  const onHandleDown = (blockId: string, date: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    blockDrag.current = { pointerId: e.pointerId, blockId, date, sx: e.clientX, sy: e.clientY, active: false, el: e.currentTarget.closest('li') };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = blockDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.active && Math.hypot(dx, dy) < DRAG_START_PX) return;
    d.active = true;
    if (d.el) {
      d.el.classList.add('dragging');
      d.el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    const over = dayAt(e.clientX);
    setDropDate(over?.object_id && over.date !== d.date ? over.date : null);
  };
  const onHandleUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = blockDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    blockDrag.current = null;
    setDropDate(null);
    if (d.el) {
      d.el.classList.remove('dragging');
      d.el.style.transform = '';
    }
    if (!d.active || e.type === 'pointercancel') return;
    const over = dayAt(e.clientX);
    if (over?.object_id && over.date !== d.date) void moveBlock(d.blockId, d.date, over.date);
  };

  return (
    <div className="timeline-page">
      <h1>Timeline</h1>
      <section
        aria-label="Daily timeline" className="timeline" ref={regionRef} tabIndex={0}
        onPointerDown={onRegionPointerDown} onPointerMove={onRegionPointerMove} onPointerUp={onRegionPointerUp} onPointerCancel={onRegionPointerUp}
      >
        <ol className="timeline-days" aria-label="Days">
          {(timeline?.days ?? []).map((day) => (
            <li
              key={day.date} className={`timeline-day${dropDate === day.date ? ' drop' : ''}`}
              ref={(el) => {
                if (el) dayEls.current.set(day.date, el);
                else dayEls.current.delete(day.date);
              }}
            >
              <h2>{dateHeading(day.date)}</h2>
              <div className="timeline-heat">
                <div className="heat-band" data-heat={day.block_count}
                  style={{ height: HEAT_BAND_PX, background: rgbCss(heatColor(theme, day.block_count)) }} />
                <span className="heat-caption mono">{plural(day.block_count, 'block')}</span>
              </div>
              {day.object_id === null ? (
                <p className="timeline-empty muted">No note</p>
              ) : day.blocks.length === 0 ? (
                <p className="timeline-empty muted">Nothing written.</p>
              ) : (
                <ul className="timeline-blocks">
                  {day.blocks.map((b) => (
                    <li key={b.id} className="timeline-block">
                      <span className="timeline-excerpt">{b.excerpt}</span>
                      {b.movable && (
                        <button
                          type="button" className="quiet icon timeline-handle" aria-label={`Move "${b.excerpt}"`}
                          ref={(el) => {
                            if (el) handleEls.current.set(b.id, el);
                            else handleEls.current.delete(b.id);
                          }}
                          onKeyDown={onHandleKey(b.id, day.date)}
                          onPointerDown={onHandleDown(b.id, day.date)} onPointerMove={onHandleMove}
                          onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
                          </svg>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
