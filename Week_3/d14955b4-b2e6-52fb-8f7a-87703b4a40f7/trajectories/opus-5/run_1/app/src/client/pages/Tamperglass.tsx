import { useEffect, useRef, useState } from 'react';
import { COPY, verdictsAnnouncement } from '../../shared/copy';
import type { ForensicsBody, ForensicsLine, ForensicsStage, ThreadMessage } from '../../shared/types';
import { openStream } from '../lib/sse';
import { useReducedMotion } from '../lib/media';

const STAGES: ForensicsStage[] = ['signature', 'bucket', 'sanitiser', 'link'];
const LABELS: Record<ForensicsStage, string> = {
  signature: 'Signature',
  bucket: 'Bucket',
  sanitiser: 'Sanitiser',
  link: 'Link',
};

function checkingLines(): ForensicsLine[] {
  return STAGES.map((stage) => ({ stage, state: 'checking', verdict: 'checking' }));
}

interface TamperglassProps {
  message: ThreadMessage | null;
  listRef: React.RefObject<HTMLUListElement | null>;
  onAccentChange(focused: boolean): void;
}

export function Tamperglass({ message, listRef, onAccentChange }: TamperglassProps): React.ReactElement {
  const [lines, setLines] = useState<ForensicsLine[]>(checkingLines);
  const [announcement, setAnnouncement] = useState('');
  const [meterLevel, setMeterLevel] = useState(8);
  const [shownCount, setShownCount] = useState(8);
  const reducedMotion = useReducedMotion();
  const fillRef = useRef<HTMLSpanElement>(null);
  const selectionRef = useRef(0);

  const selectedId = message !== null && message.kind !== 'reply' ? message.id : null;

  useEffect(() => {
    if (selectedId === null) {
      setLines(checkingLines());
      setAnnouncement('');
      return;
    }
    selectionRef.current += 1;
    const token = selectionRef.current;
    setLines(checkingLines());
    setAnnouncement('');
    const controller = new AbortController();
    openStream(
      `/api/messages/${encodeURIComponent(selectedId)}/forensics/stream`,
      {
        onEvent: (name, data) => {
          if (token !== selectionRef.current) return;
          if (name === 'stage') {
            const line = data as ForensicsLine;
            setLines((current) => current.map((entry) => (entry.stage === line.stage ? line : entry)));
            return;
          }
          if (name === 'settled') {
            const body = data as ForensicsBody;
            if (body.lines.length > 0) setLines(body.lines);
            controller.abort();
          }
        },
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [selectedId]);

  const settled = lines.every((line) => line.state === 'settled');

  useEffect(() => {
    if (selectedId === null || !settled) return;
    setAnnouncement(verdictsAnnouncement(lines.map((line) => line.verdict)));
  }, [selectedId, settled, lines]);

  const bucket = lines.find((line) => line.stage === 'bucket');
  const bucketLevel = bucket?.state === 'settled' && typeof bucket.level === 'number' ? bucket.level : null;

  useEffect(() => {
    if (bucketLevel === null) return;
    const from = shownCount;
    setMeterLevel(bucketLevel);
    if (reducedMotion || from === bucketLevel) {
      setShownCount(bucketLevel);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / 250);
      setShownCount(Math.round(from + (bucketLevel - from) * progress));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // the fill follows the settled level only
  }, [bucketLevel, reducedMotion]);

  useEffect(() => {
    const fill = fillRef.current;
    if (fill) fill.style.width = `${(meterLevel / 8) * 100}%`;
  }, [meterLevel, message]);

  if (message === null) {
    return (
      <div className="tamperglass">
        <p className="pane-note">{COPY.tamperglassIdle}</p>
      </div>
    );
  }
  if (message.kind === 'reply') {
    return (
      <div className="tamperglass">
        <p className="pane-note">{COPY.tamperglassReply}</p>
      </div>
    );
  }

  const moveFocus = (event: React.KeyboardEvent<HTMLLIElement>, index: number): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    const items = listRef.current?.querySelectorAll<HTMLLIElement>('li.check-line');
    items?.[Math.max(0, Math.min(items.length - 1, next))]?.focus();
  };

  return (
    <div className="tamperglass">
      <ul className="checks" aria-label="Checks" ref={listRef}>
        {lines.map((line, index) => (
          <li
            key={line.stage}
            className={`check-line ${line.state === 'settled' ? 'settled' : 'checking'}`}
            tabIndex={0}
            data-stage={line.stage}
            onKeyDown={(event) => moveFocus(event, index)}
            onFocus={() => onAccentChange(true)}
            onBlur={() => onAccentChange(false)}
          >
            <span className="check-label">{LABELS[line.stage]}</span>
            <span className="check-verdict" key={`${line.stage}-${line.state}-${line.verdict}`}>
              {line.stage === 'bucket' && bucketLevel !== null ? `${shownCount} of 8` : line.verdict}
            </span>
            {line.stage === 'bucket' && (
              <span
                className="meter"
                role="meter"
                aria-label="Token bucket"
                aria-valuemin={0}
                aria-valuemax={8}
                aria-valuenow={meterLevel}
              >
                <span className="meter-fill" ref={fillRef} />
              </span>
            )}
            {line.stage === 'sanitiser' && line.state === 'settled' && typeof line.before === 'string' && (
              <span className="evidence-block">
                <q className="evidence">{renderRemoved(line)}</q>
                <q className="evidence">{line.after}</q>
              </span>
            )}
            {line.stage === 'link' && line.state === 'settled' && typeof line.url === 'string' && line.url !== '' && (
              <span className="evidence-block">
                <q className="evidence">{line.url}</q>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="live-region" role="status" aria-label="Verdicts" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function renderRemoved(line: ForensicsLine): React.ReactNode[] {
  const before = line.before ?? '';
  const spans = line.removed ?? [];
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.start > cursor) parts.push(before.slice(cursor, span.start));
    parts.push(<s key={`r${index}`}>{before.slice(span.start, span.end)}</s>);
    cursor = span.end;
  });
  parts.push(before.slice(cursor));
  return parts;
}
