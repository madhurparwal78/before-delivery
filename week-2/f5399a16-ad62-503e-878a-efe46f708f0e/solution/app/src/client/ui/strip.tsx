// The Slate strip and the review page's film strip: one composite, one Tab stop, time always left to right.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { frameGapMs, nominalFrames, secondsText, timecode, type FrameRate } from '../../shared/timecode';
import { BASE, EASE, FAST, reducedMotion } from '../motion';

export interface StripClip {
  number: number;
  durationFrames: number;
  drawingUrl: string | null;
}

export function clipUnder(clips: StripClip[], position: number): { clip: StripClip; start: number } | null {
  let start = 0;
  for (const clip of clips) {
    if (position < start + clip.durationFrames) return { clip, start };
    start += clip.durationFrames;
  }
  return clips.length ? { clip: clips[clips.length - 1] as StripClip, start: start - (clips[clips.length - 1] as StripClip).durationFrames } : null;
}

function totalOf(clips: StripClip[]): number {
  return clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
}

/** A numeral whose old value rolls up and out while the new one rolls up into place. */
function Numeral({ part, value, roll }: { part: string; value: string; roll: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const before = useRef(value);
  useLayoutEffect(() => {
    if (before.current === value) return;
    const old = before.current;
    before.current = value;
    const element = ref.current;
    if (!roll || !element || reducedMotion()) return;
    const ghost = document.createElement('span');
    ghost.textContent = old;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.className = 'numeral-ghost';
    element.parentElement?.append(ghost);
    const leaving = ghost.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-100%)', opacity: 0 }], { duration: BASE, easing: EASE });
    void leaving.finished.finally(() => ghost.remove()).catch(() => undefined);
    element.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: BASE, easing: EASE });
  }, [value, roll]);
  return <span className="numeral"><span ref={ref} data-part={part} dir="ltr">{value}</span></span>;
}

interface StripProps {
  clips: StripClip[];
  rate: FrameRate;
  position: number;
  onPosition: (position: number) => void;
  groupLabel: string;
  clipLabel: (number: number) => string;
  /** `trim` or `rate` while those motions are the last change; clip widths and the playhead follow. */
  motion: '' | 'trim' | 'rate';
  /** `<target text>` on the Slate strip; the film strip has none. */
  targetLine?: string;
  onTrim?: (clip: StripClip, by: number) => void;
  onLarge?: (clip: StripClip) => void;
  onTogglePlay: () => void;
}

const EDGE_PX = 6;

export function Strip({ clips, rate, position, onPosition, groupLabel, clipLabel, motion, targetLine, onTrim, onLarge, onTogglePlay }: StripProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const clipEls = useRef(new Map<number, HTMLButtonElement>());
  const [tip, setTip] = useState<{ number: number; start: number; duration: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipClose = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef<{ mode: 'scrub' | 'trim'; clip: StripClip; startX: number; applied: number } | null>(null);
  const lastPointer = useRef('mouse');

  const total = totalOf(clips);
  const under = clipUnder(clips, position);
  const current = under?.clip.number;

  const keepInView = useCallback(() => {
    const frame = frameRef.current;
    if (!frame || !under) return;
    const left = under.start * 2;
    const right = left + under.clip.durationFrames * 2;
    if (left < frame.scrollLeft || right > frame.scrollLeft + frame.clientWidth) frame.scrollLeft = Math.max(0, left - 16);
  }, [under]);

  useLayoutEffect(() => {
    keepInView();
    const active = document.activeElement;
    if (current !== undefined && stripRef.current?.contains(active)) {
      const element = clipEls.current.get(current);
      if (element && element !== active) element.focus({ preventScroll: true });
    }
    // Follows the playhead's clip only.
  }, [current, position]);

  const startOf = (number: number): number => {
    let start = 0;
    for (const clip of clips) {
      if (clip.number === number) return start;
      start += clip.durationFrames;
    }
    return 0;
  };

  const openTip = (number: number) => {
    if (tipClose.current) clearTimeout(tipClose.current);
    const clip = clips.find((held) => held.number === number);
    if (clip) setTip({ number, start: startOf(number), duration: clip.durationFrames });
  };

  const closeTipSoon = () => {
    if (tipClose.current) clearTimeout(tipClose.current);
    tipClose.current = setTimeout(() => setTip(null), 120);
  };

  const shownTip = tip && clips.find((clip) => clip.number === tip.number) ? { ...tip, start: startOf(tip.number), duration: (clips.find((clip) => clip.number === tip.number) as StripClip).durationFrames } : null;

  useLayoutEffect(() => {
    const element = tipRef.current;
    const anchor = shownTip ? clipEls.current.get(shownTip.number) : null;
    if (!element || !anchor) return;
    const box = anchor.getBoundingClientRect();
    const size = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(box.left, innerWidth - size.width - 8));
    const top = box.top - size.height - 8 >= 8 ? box.top - size.height - 8 : box.bottom + 8;
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  });

  const tipShown = shownTip !== null;
  const tipWasShown = useRef(false);
  useLayoutEffect(() => {
    if (tipShown && !tipWasShown.current && !reducedMotion()) {
      tipRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FAST, easing: EASE });
    }
    tipWasShown.current = tipShown;
  }, [tipShown]);

  const onKey = (event: React.KeyboardEvent) => {
    const last = Math.max(0, total - 1);
    const nominal = nominalFrames(rate);
    const step = event.shiftKey ? nominal : 1;
    const go = (value: number) => {
      event.preventDefault();
      onPosition(Math.max(0, Math.min(last, value)));
    };
    switch (event.key) {
      case 'ArrowLeft': go(position - step); return;
      case 'ArrowRight': go(position + step); return;
      case 'Home': go(0); return;
      case 'End': go(last); return;
      case ' ':
        event.preventDefault();
        onTogglePlay();
        return;
      case 'Enter':
        if (under && onLarge) {
          event.preventDefault();
          onLarge(under.clip);
        }
        return;
      case 'Escape':
        if (tip) {
          event.preventDefault();
          setTip(null);
        }
        return;
      case '[': case '{':
        if (under && onTrim) {
          event.preventDefault();
          onTrim(under.clip, event.shiftKey || event.key === '{' ? -nominal : -1);
        }
        return;
      case ']': case '}':
        if (under && onTrim) {
          event.preventDefault();
          onTrim(under.clip, event.shiftKey || event.key === '}' ? nominal : 1);
        }
        return;
      default:
    }
  };

  const atPoint = (clientX: number): number => {
    const box = (stripRef.current as HTMLDivElement).getBoundingClientRect();
    return Math.max(0, Math.min(total - 1, Math.floor((clientX - box.left) / 2)));
  };

  return (
    <div role="group" aria-label={groupLabel} className="slate" dir="ltr">
      <div className="slate-stage">
        <div ref={frameRef} className="strip-frame">
          <div
            ref={stripRef}
            className="strip"
            data-motion={motion || undefined}
            style={{ width: total * 2 }}
            onKeyDown={onKey}
            onPointerDown={(event) => {
              lastPointer.current = event.pointerType;
              if (event.pointerType === 'touch' || event.button !== 0) return;
              const button = (event.target as Element).closest<HTMLElement>('[data-part="clip"]');
              if (!button) return;
              const number = Number(button.dataset.frame);
              const clip = clips.find((held) => held.number === number) as StripClip;
              const box = button.getBoundingClientRect();
              const onEnd = Boolean(onTrim) && box.right - event.clientX <= EDGE_PX && innerWidth >= 768;
              pointer.current = { mode: onEnd ? 'trim' : 'scrub', clip, startX: event.clientX, applied: 0 };
              event.currentTarget.setPointerCapture(event.pointerId);
              if (!onEnd) onPosition(atPoint(event.clientX));
            }}
            onPointerMove={(event) => {
              const held = pointer.current;
              if (!held) return;
              if (held.mode === 'scrub') onPosition(atPoint(event.clientX));
            }}
            onPointerUp={(event) => {
              const held = pointer.current;
              pointer.current = null;
              if (held?.mode === 'trim' && onTrim) {
                const frames = Math.round((event.clientX - held.startX) / 2);
                if (frames) onTrim(held.clip, frames);
              }
            }}
            onPointerCancel={() => { pointer.current = null; }}
            onClick={(event) => {
              if (lastPointer.current === 'touch' && (event.target as Element).closest('[data-part="clip"]')) onPosition(atPoint(event.clientX));
            }}
          >
            {clips.map((clip) => (
              <button
                key={clip.number}
                ref={(element) => {
                  if (element) clipEls.current.set(clip.number, element);
                  else clipEls.current.delete(clip.number);
                }}
                type="button"
                className="clip"
                aria-label={clipLabel(clip.number)}
                aria-current={clip.number === current ? 'true' : undefined}
                aria-describedby={shownTip?.number === clip.number ? 'clip-tip' : undefined}
                data-part="clip"
                data-frame={clip.number}
                data-duration={clip.durationFrames}
                tabIndex={clip.number === current ? 0 : -1}
                style={{ width: clip.durationFrames * 2 }}
                onFocus={() => openTip(clip.number)}
                onBlur={closeTipSoon}
                onPointerEnter={(event) => { if (event.pointerType !== 'touch') openTip(clip.number); }}
                onPointerLeave={(event) => { if (event.pointerType !== 'touch') closeTipSoon(); }}
              >
                {clip.drawingUrl ? <img src={clip.drawingUrl} alt="" draggable={false} /> : null}
              </button>
            ))}
            <div className="playhead" data-part="playhead" data-position={position} style={{ transform: `translateX(${position * 2}px) skewX(-18deg)` }} />
          </div>
        </div>
      </div>
      <p className="numerals">
        <Numeral part="timecode" value={timecode(position, rate)} roll={motion === 'rate'} />
        <Numeral part="seconds" value={secondsText(total, rate)} roll={motion === 'rate'} />
        {targetLine !== undefined ? <span className="numeral-target"><span className="numeral-label">Target</span> <Numeral part="target" value={targetLine} roll={motion === 'rate'} /></span> : null}
      </p>
      {shownTip
        ? createPortal(
            <div
              ref={tipRef}
              id="clip-tip"
              role="tooltip"
              className="tip"
              onPointerEnter={() => { if (tipClose.current) clearTimeout(tipClose.current); }}
              onPointerLeave={closeTipSoon}
            >
              {`Frame ${shownTip.number} · in ${timecode(shownTip.start, rate)} · out ${timecode(shownTip.start + shownTip.duration, rate)}`}
            </div>,
            document.getElementById('overlays') as HTMLElement,
          )
        : null}
    </div>
  );
}

/** Playback steps the playhead frame by frame at the rate; it stops on the last and pauses when hidden. */
export function usePlayback(rate: FrameRate, total: number, position: number, onPosition: (position: number) => void) {
  const [playing, setPlaying] = useState(false);
  const latest = useRef(position);
  latest.current = position;
  useEffect(() => {
    if (!playing) return;
    const gap = frameGapMs(rate);
    const timer = setInterval(() => {
      if (document.hidden) {
        setPlaying(false);
        return;
      }
      if (latest.current >= total - 1) {
        setPlaying(false);
        return;
      }
      onPosition(latest.current + 1);
    }, gap);
    return () => clearInterval(timer);
    // Runs while playing; the position is read through its ref.
  }, [playing, rate, total]);
  return { playing, toggle: () => setPlaying((held) => !held) };
}
