import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { BUCKET_CAPACITY, STAGES } from '../shared/types.js';
import type { ForensicsLine, Stage } from '../shared/types.js';
import { announce, useAnnouncement } from './announce.js';
import { request } from './api.js';
import { readEvents } from './sse.js';

type Lines = Record<Stage, ForensicsLine | null>;

const EMPTY: Lines = { signature: null, bucket: null, sanitiser: null, link: null };
const LABELS: Record<Stage, string> = { signature: 'Signature', bucket: 'Bucket', sanitiser: 'Sanitiser', link: 'Link' };
const FILL_MS = 250;

const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useForensics(messageId: string | null, replySelected: boolean): Lines {
  const [held, setHeld] = useState<{ id: string | null; lines: Lines }>({ id: null, lines: EMPTY });
  useEffect(() => {
    if (messageId === null || replySelected) return;
    const abort = new AbortController();
    void (async () => {
      const response = await request(`/api/messages/${messageId}/forensics/stream`, { signal: abort.signal, headers: { Accept: 'text/event-stream' } });
      if (!response.ok) return;
      await readEvents(response, (event) => {
        if (abort.signal.aborted || event.name !== 'stage') return;
        const line = JSON.parse(event.data) as ForensicsLine;
        setHeld((current) => ({ id: messageId, lines: { ...(current.id === messageId ? current.lines : EMPTY), [line.stage]: line } }));
      });
    })().catch(() => undefined);
    return () => abort.abort();
  }, [messageId, replySelected]);
  const lines = held.id === messageId ? held.lines : EMPTY;
  const sentence = STAGES.every((stage) => lines[stage] !== null)
    ? `Checked: ${STAGES.map((stage) => (lines[stage] as ForensicsLine).verdict).join('; ')}.`
    : null;
  useEffect(() => {
    if (messageId !== null && sentence !== null) announce('Verdicts', sentence);
  }, [messageId, sentence]);
  return lines;
}

function useBucketCount(line: ForensicsLine | null, fill: RefObject<HTMLSpanElement | null>): number {
  const [count, setCount] = useState(0);
  useLayoutEffect(() => {
    const level = line?.level;
    const element = fill.current;
    if (level === null || level === undefined || !element) return;
    const previous = line?.previous ?? level;
    const percent = (value: number): string => `${(value / BUCKET_CAPACITY) * 100}%`;
    if (prefersReducedMotion()) {
      element.style.transition = 'none';
      element.style.width = percent(level);
      setCount(level);
      return;
    }
    element.style.transition = 'none';
    element.style.width = percent(previous);
    element.getBoundingClientRect();
    element.style.transition = '';
    element.style.width = percent(level);
    setCount(previous);
    const started = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - started) / FILL_MS);
      setCount(Math.round(previous + (level - previous) * progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [line, fill]);
  return count;
}

function BucketBody({ line }: { line: ForensicsLine | null }) {
  const fill = useRef<HTMLSpanElement>(null);
  const count = useBucketCount(line, fill);
  const metered = line !== null && line.level !== null && line.level !== undefined;
  return (
    <>
      {line ? (
        <span key="settled" className="verdict settle">{metered ? `${count} of ${BUCKET_CAPACITY}` : line.verdict}</span>
      ) : (
        <span key="checking" className="verdict">checking</span>
      )}
      <span className="meter" role="meter" aria-label="Token bucket" aria-valuemin={0} aria-valuemax={BUCKET_CAPACITY} aria-valuenow={count}>
        <span className="meter-fill" ref={fill} />
      </span>
    </>
  );
}

function Evidence({ line }: { line: ForensicsLine }) {
  if (line.stage === 'sanitiser' && line.before !== null && line.before !== undefined) {
    const before = line.before;
    const parts: { text: string; struck: boolean }[] = [];
    let at = 0;
    for (const span of line.removed ?? []) {
      if (span.start > at) parts.push({ text: before.slice(at, span.start), struck: false });
      parts.push({ text: before.slice(span.start, span.end), struck: true });
      at = span.end;
    }
    if (at < before.length) parts.push({ text: before.slice(at), struck: false });
    return (
      <div className="evidence-group">
        <blockquote className="evidence">
          <span className="evidence-label">before</span>{' '}
          {parts.map((part, index) => (part.struck ? <del key={index}>{part.text}</del> : <span key={index}>{part.text}</span>))}
        </blockquote>
        <blockquote className="evidence">
          <span className="evidence-label">after</span> <span>{line.after}</span>
        </blockquote>
      </div>
    );
  }
  if (line.stage === 'link' && line.url) {
    return (
      <blockquote className="evidence">
        <span>{line.url}</span>
        {line.address ? <span className="evidence-label"> {line.address}</span> : null}
      </blockquote>
    );
  }
  return null;
}

function CheckLines({ lines }: { lines: Lines }) {
  const list = useRef<HTMLUListElement>(null);
  const onKey = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(list.current?.children ?? [])] as HTMLElement[];
    const index = items.indexOf(event.currentTarget);
    items[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  };
  return (
    <ul className="checks" role="list" aria-label="Checks" ref={list}>
      {STAGES.map((stage) => {
        const line = lines[stage];
        return (
          <li key={stage} className="check" tabIndex={0} onKeyDown={onKey}>
            <span className="check-label">{LABELS[stage]}</span>
            {stage === 'bucket' ? (
              <BucketBody line={line} />
            ) : line ? (
              <span key="settled" className="verdict settle">{line.verdict}</span>
            ) : (
              <span key="checking" className="verdict">checking</span>
            )}
            {line ? <Evidence line={line} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function TamperglassBody({ selected, replySelected, lines }: { selected: boolean; replySelected: boolean; lines: Lines }) {
  const verdicts = useAnnouncement('Verdicts');
  return (
    <div className="tamperglass-body">
      {!selected ? <p className="note">Select a message to see what was checked.</p> : replySelected ? <p className="note">Replies are not checked.</p> : <CheckLines lines={lines} />}
      <div role="status" aria-label="Verdicts" aria-live="polite" className="verdicts">{verdicts}</div>
    </div>
  );
}
