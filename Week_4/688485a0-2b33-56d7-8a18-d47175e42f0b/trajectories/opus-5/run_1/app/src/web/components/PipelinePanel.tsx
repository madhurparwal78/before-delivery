import { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { ApiFailure, PreviewAnswer, apiGet, apiSend, collectionPath } from '../api';
import { PASS_THROUGH, pipelineErrorText, stageDeletedText, stageMovedText, stageStatusText } from '../copy';
import { displayPretty } from '../../shared/json';
import { DocObject, fromJson } from '../../shared/values';
import { useReducedMotion, useViewport } from '../hooks';
import { ConfirmDialog } from './Dialog';
import { PaneSeparator } from './PaneSeparator';
import { JsonBlock } from './JsonBlock';
import { BandData, SieveBand } from './StageSieve';

const NEW_STAGE = '{"$match":{}}';

interface DraftAnswer {
  stages: string[];
  disabled: number[];
}

function stageOperator(text: string): string {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const keys = Object.keys(value);
    if (keys.length > 0) return keys[0];
  } catch {
    const match = /"(\$[A-Za-z]+)"/.exec(text);
    if (match) return match[1];
  }
  return '$match';
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function PipelinePanel({
  pid,
  cid,
  collectionCount,
}: {
  pid: string;
  cid: string;
  collectionCount: number;
}): JSX.Element {
  const [stages, setStages] = useState<string[]>([]);
  const [disabled, setDisabled] = useState<number[]>([]);
  const [preview, setPreview] = useState<PreviewAnswer | null>(null);
  const [capped, setCapped] = useState(false);
  const [limit, setLimit] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(0);
  const [pinText, setPinText] = useState('');
  const [pin, setPin] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [animateFrom, setAnimateFrom] = useState(0);
  const [share, setShare] = useState(50);
  const reduced = useReducedMotion();
  const viewport = useViewport();
  const listRef = useRef<HTMLUListElement>(null);
  const focusTarget = useRef<{ kind: 'card' | 'text' | 'add'; index: number } | null>(null);
  const timer = useRef<number | null>(null);

  const recompute = useCallback(
    async (
      nextStages: string[],
      nextDisabled: number[],
      nextPin: string | null,
      announceStage: number | null = null,
    ): Promise<void> => {
      if (nextStages.some((text) => !isValidJson(text))) return;
      try {
        const answer = await apiSend<PreviewAnswer>('POST', `${collectionPath(pid, cid)}/aggregate`, {
          pipeline: nextStages.map((text) => JSON.parse(text) as unknown),
          disabled: nextDisabled,
          preview: true,
          ...(nextPin ? { pin: nextPin } : {}),
        });
        setPreview(answer);
        setCapped(false);
        setError('');
        if (announceStage !== null) {
          const stage = answer.stages[announceStage];
          if (stage) {
            setStatus(
              stage.disabled
                ? PASS_THROUGH
                : stageStatusText(announceStage + 1, nextStages.length, stage.count, false, 0),
            );
          }
        }
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          setError(pipelineErrorText(failure));
          setCapped(failure.code === 'scan_limit');
          if (failure.code === 'scan_limit') {
            setLimit(Number(failure.body['limit']));
            setPreview(null);
          }
        }
      }
    },
    [pid, cid],
  );

  useEffect(() => {
    let live = true;
    void apiGet<DraftAnswer>(`${collectionPath(pid, cid)}/pipeline`)
      .then(async (answer) => {
        if (!live) return;
        setStages(answer.stages);
        setDisabled(answer.disabled);
        setLoading(false);
        await recompute(answer.stages, answer.disabled, null);
      })
      .catch(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [pid, cid, recompute]);

  const saveDraft = (nextStages: string[], nextDisabled: number[]): void => {
    void apiSend('PUT', `${collectionPath(pid, cid)}/pipeline`, {
      stages: nextStages,
      disabled: nextDisabled,
    }).catch(() => undefined);
  };

  const apply = (
    nextStages: string[],
    nextDisabled: number[],
    changedFrom: number,
    immediate: boolean,
    announceStage: number | null = null,
  ): void => {
    setStages(nextStages);
    setDisabled(nextDisabled);
    setAnimateFrom(changedFrom);
    saveDraft(nextStages, nextDisabled);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (immediate) {
      void recompute(nextStages, nextDisabled, pin, announceStage);
    } else {
      timer.current = window.setTimeout(() => {
        void recompute(nextStages, nextDisabled, pin, announceStage);
      }, 300);
    }
  };

  useEffect(() => {
    const target = focusTarget.current;
    if (!target || !listRef.current) return;
    focusTarget.current = null;
    if (target.kind === 'add') {
      document.querySelector<HTMLElement>('[data-add-stage]')?.focus();
      return;
    }
    const selector = target.kind === 'card' ? `[data-stage-index="${target.index}"]` : `[data-stage-text="${target.index}"]`;
    listRef.current.querySelector<HTMLElement>(selector)?.focus();
  }, [stages, disabled]);

  const move = (index: number, step: number): void => {
    const target = index + step;
    if (target < 0 || target >= stages.length) return;
    const nextStages = stages.slice();
    const [moved] = nextStages.splice(index, 1);
    nextStages.splice(target, 0, moved);
    const nextDisabled = disabled.map((position) => {
      if (position === index) return target;
      if (step > 0 && position > index && position <= target) return position - 1;
      if (step < 0 && position < index && position >= target) return position + 1;
      return position;
    });
    apply(nextStages, nextDisabled, Math.min(index, target), true);
    setStatus(stageMovedText(target + 1, nextStages.length));
    setSelected(target);
    focusTarget.current = { kind: 'card', index: target };
  };

  const moveTo = (from: number, to: number): void => {
    if (from !== to) move(from, to - from);
  };

  /** Dragging by the move handle, by pointer or by a long press on touch. */
  const startDrag = (event: React.PointerEvent, from: number): void => {
    const touch = event.pointerType === 'touch';
    let armed = !touch;
    let target = from;
    const longPress = touch
      ? window.setTimeout(() => {
          armed = true;
        }, 500)
      : 0;
    const onMove = (pointer: PointerEvent): void => {
      if (!armed) return;
      const under = document
        .elementFromPoint(pointer.clientX, pointer.clientY)
        ?.closest<HTMLElement>('[data-stage-index]');
      if (under) target = Number(under.getAttribute('data-stage-index'));
    };
    const onUp = (): void => {
      window.clearTimeout(longPress);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (armed) moveTo(from, target);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const removeStage = (index: number): void => {
    const nextStages = stages.filter((_text, position) => position !== index);
    const nextDisabled = disabled
      .filter((position) => position !== index)
      .map((position) => (position > index ? position - 1 : position));
    apply(nextStages, nextDisabled, Math.max(index - 1, 0), true);
    setStatus(stageDeletedText(index + 1));
    setConfirming(null);
    if (nextStages.length === 0) focusTarget.current = { kind: 'add', index: 0 };
    else focusTarget.current = { kind: 'card', index: Math.min(index, nextStages.length - 1) };
  };

  const toggle = (index: number): void => {
    const nextDisabled = disabled.includes(index)
      ? disabled.filter((position) => position !== index)
      : [...disabled, index].sort((left, right) => left - right);
    apply(stages, nextDisabled, index, true, index);
  };

  const addStage = (): void => {
    const nextStages = [...stages, NEW_STAGE];
    apply(nextStages, disabled, nextStages.length - 1, true);
    setStatus('');
    setSelected(nextStages.length - 1);
    focusTarget.current = { kind: 'text', index: nextStages.length - 1 };
  };

  const input = preview?.input ?? collectionCount;
  const bands: BandData[] = stages.map((text, index) => {
    const stage = preview?.stages[index];
    return {
      index,
      label: stageOperator(text),
      count: capped ? limit : (stage?.count ?? 0),
      disabled: disabled.includes(index),
      capped,
      invalid: !isValidJson(text),
    };
  });

  const stopIndex = preview?.pin?.stopped_at ?? null;
  const previewStage = preview?.stages[selected];

  return (
    <div className="pipeline-grid" style={{ ['--pipeline-share' as string]: `${share}%` }}>
      <div className="stack pipeline-stages">
      <div className="toolbar">
        <button type="button" className="primary" data-add-stage="true" onClick={addStage}>
          Add stage
        </button>
        <label htmlFor="pin-document">Pin document</label>
        <input
          id="pin-document"
          type="text"
          aria-label="Pin document"
          value={pinText}
          onChange={(event) => setPinText(event.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            setPin(pinText);
            void recompute(stages, disabled, pinText);
          }}
        >
          Pin
        </button>
        <button
          type="button"
          onClick={() => {
            setPin(null);
            setPinText('');
            void recompute(stages, disabled, null);
          }}
        >
          Unpin
        </button>
      </div>

      <ul className="sieve" aria-label="Pipeline stages" ref={listRef} aria-busy={loading ? 'true' : undefined}>
        {bands.map((band) => {
          const position = band.index + 1;
          const pinKind =
            pin && stopIndex !== null && stopIndex === band.index
              ? 'stop'
              : pin && stopIndex === null && band.index === bands.length - 1
                ? 'end'
                : null;
          return (
            <li key={band.index}>
              <div
                className="stage-card"
                role="group"
                aria-label={`Stage ${position}: ${band.label}`}
                tabIndex={0}
                data-stage-index={band.index}
                data-stage-count={band.count}
                data-capped={band.capped ? 'true' : 'false'}
                data-disabled={band.disabled ? 'true' : 'false'}
                onFocus={() => setSelected(band.index)}
                onKeyDown={(event) => {
                  if (event.altKey && event.key === 'ArrowUp') {
                    event.preventDefault();
                    move(band.index, -1);
                  } else if (event.altKey && event.key === 'ArrowDown') {
                    event.preventDefault();
                    move(band.index, 1);
                  } else if (
                    event.key === 'Delete' &&
                    (event.target as HTMLElement).getAttribute('data-stage-index') !== null
                  ) {
                    event.preventDefault();
                    setConfirming(band.index);
                  }
                }}
              >
                <div className="stage-head">
                  <span className="stage-label">
                    <span className="stage-number count">{position}</span> {band.label}
                  </span>
                  <button
                    type="button"
                    aria-label={`Move stage ${position}`}
                    onPointerDown={(event) => startDrag(event, band.index)}
                  >
                    <GripVertical aria-hidden="true" size={16} />
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!band.disabled}
                    aria-label={`Enable stage ${position}`}
                    onClick={() => toggle(band.index)}
                  >
                    {band.disabled ? 'Off' : 'On'}
                  </button>
                  <button type="button" aria-label={`Delete stage ${position}`} onClick={() => setConfirming(band.index)}>
                    Delete
                  </button>
                </div>
                <textarea
                  className="code"
                  aria-label={`Stage ${position} JSON`}
                  data-stage-text={band.index}
                  rows={2}
                  spellCheck={false}
                  value={stages[band.index]}
                  onChange={(event) => {
                    const nextStages = stages.slice();
                    nextStages[band.index] = event.target.value;
                    apply(nextStages, disabled, band.index, false, band.index);
                  }}
                />
                <SieveBand
                  band={band}
                  total={bands.length}
                  input={input}
                  limit={limit}
                  animateFrom={animateFrom}
                  reduced={reduced}
                  pin={pinKind}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div role="status" aria-label="Pipeline status">
        {status}
      </div>
      <div role="alert" aria-label="Pipeline error">
        {error}
      </div>
      {viewport === 'phone' ? null : (
        <PaneSeparator label="Resize pipeline pane" value={share} orientation="horizontal" onChange={setShare} />
      )}
      </div>

      <section aria-label="Stage preview" className="stack pipeline-preview">
        <h4>Stage preview</h4>
        {previewStage ? (
          previewStage.documents.map((doc, position) => (
            <JsonBlock key={position} text={displayPretty(fromJson(doc) as DocObject)} />
          ))
        ) : (
          <p className="secondary">Focus a stage to see its first documents.</p>
        )}
      </section>

      {confirming !== null ? (
        <ConfirmDialog
          label={`Delete stage ${confirming + 1} (${bands[confirming]?.label ?? '$match'})?`}
          confirmLabel="Delete"
          onCancel={() => setConfirming(null)}
          onConfirm={() => removeStage(confirming)}
        />
      ) : null}
    </div>
  );
}
