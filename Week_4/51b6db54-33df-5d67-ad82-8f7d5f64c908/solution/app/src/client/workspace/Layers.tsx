import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { api, refusal } from '../api';
import { clearAlerts, EmptyState, raise } from '../ui';
import { BLENDS } from '../../shared/rules';
import type { Model } from './model';
import { usePickup } from './pickup';
import { useModel } from './use-model';

export function Layers({ m }: { m: Model }): JSX.Element {
  useModel(m);
  const [focusId, setFocusId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sending = useRef<{ busy: boolean; next: number | null }>({ busy: false, next: null });
  const layer = m.layer;
  const pickup = usePickup(
    m,
    m.layers.map((l) => ({ id: l.id, label: l.name })),
    (id, position) => void patch(id, { position }),
  );
  const display = pickup.shown().map((item) => m.layers.find((l) => l.id === item.id)).filter((l) => l !== undefined);

  const guard = (): boolean => {
    if (m.online) return true;
    raise('You are offline');
    return false;
  };

  const patch = async (id: number, body: Record<string, unknown>): Promise<void> => {
    if (!guard()) return;
    clearAlerts();
    const result = await api('PATCH', `/api/sprites/${m.spriteId}/layers/${id}`, body);
    if (!result.ok) raise(refusal(result).message);
  };

  const sendOpacity = async (value: number): Promise<void> => {
    const state = sending.current;
    if (state.busy) {
      state.next = value;
      return;
    }
    state.busy = true;
    if (layer) {
      layer.opacity = value;
      m.touchDocument();
      m.changed();
      await patch(layer.id, { opacity: value });
    }
    state.busy = false;
    if (state.next !== null) {
      const next = state.next;
      state.next = null;
      void sendOpacity(next);
    }
  };

  const post = async (path: string, method = 'POST'): Promise<void> => {
    if (!guard()) return;
    clearAlerts();
    const result = await api(method, `/api/sprites/${m.spriteId}/layers${path}`, method === 'POST' && path === '' ? {} : undefined);
    if (!result.ok) raise(refusal(result).message);
  };

  const onKeyDown = (event: KeyboardEvent, id: number, at: number): void => {
    if (m.canEdit && pickup.onKey(event, id)) return;
    const move = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (move !== 0) {
      event.preventDefault();
      const target = display[Math.max(0, Math.min(display.length - 1, at + move))];
      if (target) {
        setFocusId(target.id);
        listRef.current?.querySelector<HTMLElement>(`[data-layer-id="${target.id}"]`)?.focus();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      m.layerId = id;
      m.changed();
    }
  };

  const holds = layer?.locked_by === m.me.name;
  const mayUnlock = layer?.locked_by != null && (holds || m.role === 'owner');
  return (
    <section class="panel cyan" aria-label="Layers">
      <div class="panel-title">
        <h2>Layers</h2>
        {m.canEdit && (
          <button type="button" class="pill" onClick={() => void post('')}>
            Add layer
          </button>
        )}
      </div>
      <div class="panel-body">
        {m.layers.length === 0 ? (
          <EmptyState text="No layers yet" />
        ) : (
          <div role="listbox" aria-label="Layers" class="layer-list" ref={listRef}>
            {display.map((l, at) => (
              <div
                key={l.id}
                role="option"
                aria-label={l.name}
                aria-selected={m.layerId === l.id}
                data-layer-id={l.id}
                data-lifted={pickup.lifted?.id === l.id || undefined}
                class="layer-row"
                tabIndex={(focusId ?? m.layerId) === l.id ? 0 : -1}
                onClick={() => {
                  m.layerId = l.id;
                  m.changed();
                }}
                onFocus={() => setFocusId(l.id)}
                onKeyDown={(event) => onKeyDown(event, l.id, at)}
                {...(m.canEdit ? pickup.dragProps(l.id, true) : {})}
              >
                <span class="layer-name">{l.name}</span>
                <span class="muted small">
                  {l.opacity}% {l.blend}
                  {!l.visible && ' · hidden'}
                </span>
                {l.locked_by && <span class="locked">Locked by {l.locked_by}</span>}
              </div>
            ))}
          </div>
        )}
        {m.canEdit && layer && (
          <div class="controls">
            <div class="row">
              <button
                type="button"
                class="pill"
                disabled={layer.locked_by !== null && !mayUnlock}
                onClick={() => void post(`/${layer.id}/lock`, layer.locked_by === null ? 'POST' : 'DELETE')}
              >
                {layer.locked_by !== null && mayUnlock ? 'Unlock layer' : 'Lock layer'}
              </button>
              <button type="button" class="pill" disabled={m.layers[m.layers.length - 1]?.id === layer.id} onClick={() => void post(`/${layer.id}/merge-down`)}>
                Merge down
              </button>
            </div>
            <label class="field-label">
              Layer opacity
              <input type="range" min={0} max={100} value={layer.opacity} onInput={(event) => void sendOpacity(Number((event.currentTarget as HTMLInputElement).value))} />
            </label>
            <label class="field-label">
              Blend
              <select class="input" value={layer.blend} onChange={(event) => void patch(layer.id, { blend: (event.currentTarget as HTMLSelectElement).value })}>
                {BLENDS.map((blend) => (
                  <option key={blend} value={blend}>
                    {blend === 'normal' ? 'Normal' : 'Multiply'}
                  </option>
                ))}
              </select>
            </label>
            <label class="check">
              <input type="checkbox" checked={layer.visible} onChange={(event) => void patch(layer.id, { visible: (event.currentTarget as HTMLInputElement).checked })} />
              Layer visible
            </label>
          </div>
        )}
      </div>
    </section>
  );
}
