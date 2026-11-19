import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, refusal } from '../api';
import { clearAlerts, EmptyState, notify, raise } from '../ui';
import { isColour } from '../../shared/colour';
import type { Model } from './model';
import { usePickup } from './pickup';
import { useModel } from './use-model';

export function Palette({ m }: { m: Model }): JSX.Element {
  useModel(m);
  const [colour, setColour] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const picker = useRef<HTMLInputElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ordered = m.order.map((index) => m.swatch(index)).filter((s) => s !== undefined);
  const primary = m.swatch(m.primary);
  useEffect(() => setColour(primary?.color ?? ''), [m.primary, primary?.color]);

  const pickup = usePickup(
    m,
    ordered.map((s) => ({ id: s.index, label: `Swatch ${s.index}` })),
    (index, position) => {
      const next = m.order.filter((i) => i !== index);
      next.splice(position - 1, 0, index);
      void api('PATCH', `/api/palettes/${m.paletteId}/order`, { order: next });
    },
  );
  const display = pickup.shown().map((item) => ordered.find((s) => s.index === item.id)).filter((s) => s !== undefined);

  const choose = (index: number, secondary: boolean): void => {
    if (secondary) {
      m.secondary = index;
      m.announce(`Secondary swatch ${index}`);
    } else {
      m.primary = index;
      m.changed();
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

  const save = async (): Promise<void> => {
    if (!primary || !guard()) return;
    clearAlerts();
    notify('Saving swatch…');
    const result = await api('PATCH', `/api/palettes/${m.paletteId}/swatches/${primary.index}`, { color: colour, version: primary.version });
    if (result.ok) {
      setErrors({});
      return notify('');
    }
    notify('');
    if (result.status === 409 && (result.body as { error?: string }).error === 'version_conflict') {
      const current = await api<{ swatches: { index: number; color: string; version: number; edited_by: string | null }[] }>('GET', `/api/palettes/${m.paletteId}`);
      const latest = current.body.swatches?.find((s) => s.index === primary.index);
      if (latest) {
        const at = m.swatches.findIndex((s) => s.index === latest.index);
        if (at >= 0) m.swatches[at] = { index: latest.index, color: latest.color, version: latest.version, edited_by: latest.edited_by };
        raise(`${latest.edited_by ?? 'Someone'} changed this swatch first`);
        m.changed();
      }
      return;
    }
    fail(result);
  };

  const add = async (): Promise<void> => {
    if (!guard()) return;
    clearAlerts();
    const result = await api<{ index: number }>('POST', `/api/palettes/${m.paletteId}/swatches`, { color: isColour(colour) ? colour : 'ffffffff' });
    if (!result.ok) return fail(result);
    setErrors({});
  };

  const remove = async (): Promise<void> => {
    if (!primary || !guard()) return;
    clearAlerts();
    const index = primary.index;
    const result = await api('DELETE', `/api/palettes/${m.paletteId}/swatches/${index}`);
    if (!result.ok) return fail(result);
    notify(`Swatch ${index} removed`);
  };

  const ramp = async (): Promise<void> => {
    if (!guard()) return;
    clearAlerts();
    const result = await api('POST', `/api/palettes/${m.paletteId}/ramp`, { from: m.primary, to: m.secondary, steps: m.rampSteps });
    if (!result.ok) fail(result);
  };

  const importFile = async (file: File): Promise<void> => {
    if (!guard()) return;
    clearAlerts();
    notify('Importing palette…');
    const text = await file.text();
    const result = await api<{ added: number }>('POST', `/api/palettes/${m.paletteId}/import`, { file_name: file.name, text });
    if (picker.current) picker.current.value = '';
    if (!result.ok) {
      notify('');
      return fail(result);
    }
    notify(`Added ${m.plural(result.body.added, 'swatch', 'swatches')}`);
  };

  const onKeyDown = (event: KeyboardEvent, swatchIndex: number, at: number): void => {
    if (pickup.onKey(event, swatchIndex)) return;
    const move = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (move !== 0) {
      event.preventDefault();
      const target = display[Math.max(0, Math.min(display.length - 1, at + move))];
      if (target) {
        setFocusIndex(target.index);
        listRef.current?.querySelector<HTMLElement>(`[data-swatch="${target.index}"]`)?.focus();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(swatchIndex, event.shiftKey);
    }
  };

  const rampDisabled = m.primary === 0 || m.secondary === 0;
  return (
    <section class="panel mint" aria-label="Palette">
      <h2 class="panel-title">Palette</h2>
      <div class="panel-body">
        {ordered.length === 0 ? (
          <EmptyState text="No swatches yet" />
        ) : (
          <div role="listbox" aria-label="Palette" class="swatch-list" ref={listRef}>
            {display.map((swatch, at) => {
              const used = m.shownUsed.get(swatch.index) ?? m.counts.pixels[swatch.index] ?? 0;
              const lifted = pickup.lifted?.id === swatch.index;
              const primary = m.primary === swatch.index;
              const secondary = m.secondary === swatch.index && !primary;
              const detail = `swatch-detail-${swatch.index}`;
              // The option is named only by its visible label; the colour, count and role badge sit beside it
              // (described, not named), so the accessible name stays exactly "Swatch <n>".
              return (
                <div
                  key={swatch.index}
                  role="none"
                  class={`swatch-cell${primary ? ' is-primary' : ''}${secondary ? ' is-secondary' : ''}${lifted ? ' is-lifted' : ''}`}
                  onClick={(event) => {
                    if (event.target === event.currentTarget || (event.target as Element).closest('.swatch-detail')) choose(swatch.index, event.shiftKey);
                  }}
                >
                  <div
                    role="option"
                    aria-label={`Swatch ${swatch.index}`}
                    aria-describedby={detail}
                    aria-selected={primary}
                    data-swatch={swatch.index}
                    data-used-by={m.counts.pixels[swatch.index] ?? 0}
                    data-role={primary ? 'primary' : secondary ? 'secondary' : undefined}
                    data-lifted={lifted || undefined}
                    class="swatch"
                    tabIndex={(focusIndex ?? m.primary) === swatch.index ? 0 : -1}
                    onClick={(event) => choose(swatch.index, event.shiftKey)}
                    onKeyDown={(event) => onKeyDown(event, swatch.index, at)}
                    onFocus={() => setFocusIndex(swatch.index)}
                    {...(m.canEdit ? pickup.dragProps(swatch.index, true) : {})}
                  >
                    <span class="chip" style={{ background: `#${swatch.color.slice(0, 6)}`, opacity: parseInt(swatch.color.slice(6), 16) / 255 }} />
                    <span class="swatch-name">Swatch {swatch.index}</span>
                  </div>
                  <span class="swatch-detail" id={detail} aria-hidden="true">
                    <span class="hex">{swatch.color}</span>
                    <span class="used">Used by {m.plural(used, 'pixel')}</span>
                    {primary && <span class="badge">1st</span>}
                    {secondary && <span class="badge">2nd</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {m.canEdit && (
          <div class="controls">
            <label class="field-label">
              Swatch colour
              <input class="input mono" type="text" value={colour} spellcheck={false} onInput={(event) => setColour((event.currentTarget as HTMLInputElement).value)} aria-invalid={errors.color ? 'true' : undefined} />
            </label>
            {errors.color && <p class="field-error">{errors.color}</p>}
            {errors.index && <p class="field-error">{errors.index}</p>}
            <div class="row">
              <button type="button" class="pill" onClick={() => void save()} disabled={!primary}>
                Save swatch
              </button>
              <button type="button" class="pill" onClick={() => void add()}>
                Add swatch
              </button>
              <button type="button" class="pill" onClick={() => void remove()} disabled={!primary}>
                Remove swatch
              </button>
            </div>
            <div class="row">
              <label class="field-label compact">
                Ramp steps
                <input class="input" type="number" min={3} max={32} value={m.rampSteps} onInput={(event) => { m.rampSteps = Number((event.currentTarget as HTMLInputElement).value); }} />
              </label>
              <button type="button" class="pill" onClick={() => void ramp()} disabled={rampDisabled}>
                Add ramp
              </button>
            </div>
            <div class="row">
              <input ref={picker} hidden type="file" aria-label="Palette file" accept=".hex,.gpl,text/plain" onChange={(event) => { const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (file) void importFile(file); }} />
              <button type="button" class="pill" onClick={() => { const file = picker.current?.files?.[0]; if (file) void importFile(file); else picker.current?.click(); }}>
                Import palette
              </button>
            </div>
            {errors.file && <p class="field-error">{errors.file}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
