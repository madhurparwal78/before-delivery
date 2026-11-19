import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, refusal } from '../api';
import { clearAlerts, EmptyState, raise } from '../ui';
import { durationLine } from '../../shared/format';
import { DIRECTIONS, type Direction } from '../../shared/rules';
import { showFrame } from './draw';
import { useDraft } from './draft';
import type { Model } from './model';
import { paintPixels } from './paint';
import { usePickup } from './pickup';
import { useModel } from './use-model';

const WINDOW = 40;

function Thumb({ m, frameId, index }: { m: Model; frameId: number; index: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = Math.min(56 / m.width, 40 / m.height);
  useLayoutEffect(() => {
    if (ref.current) paintPixels(ref.current, m.frameRgba(frameId, 'thumb', index), m.width, m.height, 1);
  });
  return <canvas ref={ref} class="thumb" width={m.width} height={m.height} data-thumb-seq={m.thumbSeq.get(frameId) ?? 0} style={{ width: `${m.width * scale}px`, height: `${m.height * scale}px` }} />;
}

const isLinked = (m: Model, frameId: number): boolean =>
  [...m.cels].some(([key, buffer]) => {
    const [frame, layer] = key.split(':').map(Number);
    return frame === frameId && [...m.cels].some(([other, id]) => id === buffer && other !== key && other.endsWith(`:${layer}`));
  });

export function Frames({ m }: { m: Model }): JSX.Element {
  useModel(m);
  const total = m.frames.length;
  const [focusId, setFocusId] = useState<number | null>(null);
  const wantFocus = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const draft = useDraft(`tag:${m.spriteId}`);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ from: 1, to: 1, direction: 'forward' as Direction, repeat: 0 });
  const focused = m.frames.findIndex((f) => f.id === (focusId ?? m.frameId));
  const focusAt = focused < 0 ? 0 : focused;

  const pickup = usePickup(
    m,
    m.frames.map((f, i) => ({ id: f.id, label: `Frame ${i + 1}` })),
    (id, position) => void api('PATCH', `/api/sprites/${m.spriteId}/frames/${m.frames.findIndex((f) => f.id === id) + 1}`, { position }).then((r) => (r.ok ? undefined : raise(refusal(r).message))),
  );
  const order = pickup.shown().map((item) => m.frames.find((f) => f.id === item.id)).filter((f) => f !== undefined);
  const start = Math.max(0, Math.min(Math.max(0, total - WINDOW), focusAt - Math.floor(WINDOW / 2)));
  const rows = order.slice(start, start + WINDOW);

  useLayoutEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-frame-id="${focusId}"]`)?.focus();
  });

  const moveFocus = (index: number): void => {
    const target = order[Math.max(0, Math.min(total - 1, index))];
    if (!target) return;
    wantFocus.current = true;
    setFocusId(target.id);
  };

  const onKeyDown = (event: KeyboardEvent, id: number, at: number): void => {
    if (m.canEdit && pickup.onKey(event, id)) return;
    const jumps: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: total - 1, PageDown: at + 10, PageUp: at - 10 };
    const target = jumps[event.key];
    if (target !== undefined) {
      event.preventDefault();
      moveFocus(target);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      showFrame(m, id);
    }
  };

  const fail = (result: Parameters<typeof refusal>[0]): void => {
    const { message, fields } = refusal(result);
    setErrors(fields);
    raise(message);
  };

  const guard = (): boolean => {
    if (m.online) return true;
    raise('You are offline');
    return false;
  };

  const addFrame = async (): Promise<void> => {
    if (!guard()) return;
    clearAlerts();
    const result = await api('POST', `/api/sprites/${m.spriteId}/frames`, { duration_ms: m.frames[m.frameNumber - 1]?.duration_ms ?? 100 });
    if (!result.ok) fail(result);
  };

  const setDuration = async (value: string): Promise<void> => {
    if (!guard()) return;
    clearAlerts();
    const result = await api('PATCH', `/api/sprites/${m.spriteId}/frames/${m.frameNumber}`, { duration_ms: Number(value) });
    if (!result.ok) fail(result);
    else setErrors({});
  };

  const link = async (action: 'link' | 'unlink'): Promise<void> => {
    if (!guard() || !m.layer) return;
    clearAlerts();
    const body = action === 'link' ? { layer: m.layer.name, to_frame: m.frameNumber - 1 } : { layer: m.layer.name };
    const result = await api('POST', `/api/sprites/${m.spriteId}/frames/${m.frameNumber}/cels/${action}`, body);
    if (!result.ok) fail(result);
  };

  const addTag = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!guard()) return;
    clearAlerts();
    const result = await api('POST', `/api/sprites/${m.spriteId}/tags`, { name: draft.text, from: form.from, to: form.to, direction: form.direction, repeat: form.repeat });
    if (!result.ok) return fail(result);
    setErrors({});
    await draft.reset();
  };

  const duration = m.frames[m.frameNumber - 1]?.duration_ms ?? 100;
  const linked = m.frames[m.frameNumber - 1] ? isLinked(m, m.frames[m.frameNumber - 1]?.id ?? 0) : false;
  const totalMs = m.frames.reduce((sum, f) => sum + f.duration_ms, 0);
  return (
    <section class="panel lemon" aria-label="Frames">
      <div class="panel-title">
        <h2>Frames</h2>
        {m.canEdit && (
          <button type="button" class="pill" onClick={() => void addFrame()}>
            Add frame
          </button>
        )}
      </div>
      <div class="panel-body">
        <p class="totals" data-total-ms={totalMs}>
          {durationLine(
            m.frames.map((f) => f.duration_ms),
            m.locale.number_format,
          )}
        </p>
        {total === 0 ? (
          <EmptyState text="No frames yet" />
        ) : (
          <div role="grid" aria-label="Frames" aria-rowcount={total} class="frame-grid" ref={gridRef}>
            {rows.map((frame, i) => {
              const at = start + i;
              return (
                <div
                  key={frame.id}
                  role="row"
                  aria-label={`Frame ${at + 1}`}
                  aria-rowindex={at + 1}
                  aria-selected={frame.id === m.frameId}
                  data-frame-id={frame.id}
                  data-lifted={pickup.lifted?.id === frame.id || undefined}
                  class="frame-row"
                  tabIndex={frame.id === (focusId ?? m.frameId) ? 0 : -1}
                  onFocus={() => setFocusId(frame.id)}
                  onClick={() => showFrame(m, frame.id)}
                  onKeyDown={(event) => onKeyDown(event, frame.id, at)}
                  {...(m.canEdit ? pickup.dragProps(frame.id, true) : {})}
                >
                  <div role="gridcell" class="frame-cell">
                    <Thumb m={m} frameId={frame.id} index={at} />
                    <span class="frame-meta">
                      <span>{at + 1}</span>
                      <span class="muted small">{m.fmt(frame.duration_ms)} ms</span>
                      {isLinked(m, frame.id) && <span class="linked">Linked</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {m.canEdit && (
          <div class="controls">
            <div class="row">
              <label class="field-label compact">
                Frame duration
                <input class="input" type="number" key={`${m.frameId}-${duration}`} defaultValue={duration} onChange={(event) => void setDuration((event.currentTarget as HTMLInputElement).value)} />
              </label>
            </div>
            {errors.duration_ms && <p class="field-error">{errors.duration_ms}</p>}
            <div class="row">
              <button type="button" class="pill" disabled={m.frameNumber < 2 || linked} onClick={() => void link('link')}>
                Link cel
              </button>
              <button type="button" class="pill" disabled={!linked} onClick={() => void link('unlink')}>
                Unlink cel
              </button>
            </div>
            <form class="stack" onSubmit={(event) => void addTag(event)} noValidate>
              <label class="field-label">
                Tag name
                <input class="input" type="text" value={draft.text} onInput={(event) => draft.edit((event.currentTarget as HTMLInputElement).value)} aria-invalid={errors.name ? 'true' : undefined} />
              </label>
              {errors.name && <p class="field-error">{errors.name}</p>}
              <div class="row">
                <label class="field-label compact">
                  Tag from
                  <input class="input" type="number" min={1} max={total} value={form.from} onInput={(event) => setForm({ ...form, from: Number((event.currentTarget as HTMLInputElement).value) })} />
                </label>
                <label class="field-label compact">
                  Tag to
                  <input class="input" type="number" min={1} max={total} value={form.to} onInput={(event) => setForm({ ...form, to: Number((event.currentTarget as HTMLInputElement).value) })} />
                </label>
              </div>
              {(errors.from || errors.to) && <p class="field-error">{errors.from ?? errors.to}</p>}
              <div class="row">
                <label class="field-label compact">
                  Tag direction
                  <select class="input" value={form.direction} onChange={(event) => setForm({ ...form, direction: (event.currentTarget as HTMLSelectElement).value as Direction })}>
                    {DIRECTIONS.map((direction) => (
                      <option key={direction} value={direction}>
                        {direction.charAt(0).toUpperCase() + direction.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="field-label compact">
                  Tag repeat
                  <input class="input" type="number" min={0} max={99} value={form.repeat} onInput={(event) => setForm({ ...form, repeat: Number((event.currentTarget as HTMLInputElement).value) })} />
                </label>
              </div>
              {(errors.direction || errors.repeat) && <p class="field-error">{errors.direction ?? errors.repeat}</p>}
              <div class="row">
                <button type="submit" class="pill">
                  Add tag
                </button>
                {m.commentAt === null && (
                  <span role="status" aria-label="Draft status" class="draft-status">
                    {draft.status}
                  </span>
                )}
                {draft.newer && (
                  <button type="button" class="pill small" onClick={draft.loadNewer}>
                    Load newer
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
        {m.tags.length > 0 && (
          <ul class="tag-list">
            {m.tags.map((t) => (
              <li key={t.id}>
                {t.name} · {t.from}–{t.to} · {t.direction}
                {t.repeat > 0 ? ` · ×${t.repeat}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
