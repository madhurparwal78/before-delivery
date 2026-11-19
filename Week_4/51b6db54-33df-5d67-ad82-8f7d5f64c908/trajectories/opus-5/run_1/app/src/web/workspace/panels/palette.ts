import { api, refusalText, type ApiFailure } from '../../api.js';
import {
  button,
  checkbox,
  clear,
  combobox,
  el,
  field,
  keepingFocus,
  spinbutton,
  textbox,
} from '../../dom.js';
import { num } from '../../session.js';
import type { Workspace } from '../context.js';
import type { PaletteView } from '../model.js';
import { wirePickup } from '../pickup.js';

export interface Panel {
  node: HTMLElement;
  refresh(): void;
}

export interface PalettePanel extends Panel {
  showCount(index: number, shown: number): void;
}

/** The Palette panel: swatch rows with their true counts, edits and ramps. */
export function palettePanel(ctx: Workspace): PalettePanel {
  const listbox = el('div', { role: 'listbox', 'aria-label': 'Palette', class: 'swatch-list' });
  const colourInput = textbox('Swatch colour');
  const rampSteps = spinbutton('Ramp steps', 5, { min: '3', max: '32' });
  const fileInput = el('input', { type: 'file', 'aria-label': 'Palette file', accept: '.hex,.gpl' });
  const body = el('div', { class: 'panel-body' });

  const saveSwatch = button('Save swatch', async () => {
    const model = ctx.model;
    const swatch = model.palette.swatches.find((entry) => entry.index === model.primary);
    if (swatch === undefined) return;
    ctx.regions.notice('Saving swatch…');
    const result = await api.patch<
      ApiFailure & { index: number; color: string; version: number; used_by: number; frames: number; seq: number }
    >(`/api/palettes/${model.palette.id}/swatches/${swatch.index}`, {
      color: colourInput.value.trim(),
      version: swatch.version,
    });
    if (!result.ok) {
      if (result.body.error === 'version_conflict') {
        const fresh = await api.get<PaletteView>(`/api/palettes/${model.palette.id}`);
        if (fresh.ok) model.palette = fresh.body;
        const current = model.palette.swatches.find((entry) => entry.index === swatch.index);
        ctx.regions.alert(`${current?.edited_by ?? 'Someone'} changed this swatch first`);
      } else {
        ctx.regions.alert(refusalText(result));
      }
      ctx.regions.notice('');
      ctx.refreshPanels();
      ctx.repaint();
      return;
    }
    ctx.regions.notice('');
    const old = swatch.color;
    swatch.color = result.body.color;
    swatch.version = result.body.version;
    swatch.used_by = result.body.used_by;
    swatch.frames = result.body.frames;
    model.sprite.seq = result.body.seq;
    ctx.startFlood({
      index: swatch.index,
      oldColour: old,
      newColour: result.body.color,
      cursor: { ...model.cursor },
      usedBy: result.body.used_by,
      frames: result.body.frames,
      seq: result.body.seq,
      by: 'you',
    });
  });

  const addSwatch = button('Add swatch', async () => {
    const result = await api.post<ApiFailure>(`/api/palettes/${ctx.model.palette.id}/swatches`, {
      color: colourInput.value.trim() === '' ? 'ffffffff' : colourInput.value.trim(),
    });
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    await ctx.reload();
  });

  const removeSwatch = button('Remove swatch', async () => {
    const index = ctx.model.primary;
    const result = await api.remove<ApiFailure>(
      `/api/palettes/${ctx.model.palette.id}/swatches/${index}`,
    );
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    ctx.regions.notice(`Swatch ${index} removed`);
    await ctx.reload();
  });

  const addRamp = button('Add ramp', async () => {
    const result = await api.post<ApiFailure>(`/api/palettes/${ctx.model.palette.id}/ramp`, {
      from: ctx.model.primary,
      to: ctx.model.secondary,
      steps: Number(rampSteps.value),
    });
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    await ctx.reload();
  });

  const importPalette = button('Import palette', async () => {
    const file = fileInput.files?.[0];
    if (file === undefined) return;
    ctx.regions.notice('Importing palette…');
    const result = await api.post<ApiFailure & { added: number }>(
      `/api/palettes/${ctx.model.palette.id}/import`,
      { file_name: file.name, text: await file.text() },
    );
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      ctx.regions.notice('');
      return;
    }
    ctx.regions.notice(`Added ${num(result.body.added)} swatches`);
    await ctx.reload();
  });

  const refresh = (): void => {
    keepingFocus(listbox, () => refreshNow(), () => {
      (listbox.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();
    });
  };

  const refreshNow = (): void => {
    const model = ctx.model;
    clear(listbox);
    const rows = model.palette.order
      .map((index) => model.palette.swatches.find((swatch) => swatch.index === index))
      .filter((swatch): swatch is NonNullable<typeof swatch> => swatch !== undefined);
    const choose = (index: number, secondary: boolean): void => {
      if (secondary) {
        model.secondary = index;
        ctx.announceStage(`Secondary swatch ${index}`);
      } else {
        model.primary = index;
        colourInput.value = rows.find((swatch) => swatch.index === index)?.color ?? '';
      }
      refresh();
    };
    const items = rows.map((swatch) => {
      const option = el('div', {
        role: 'option',
        'aria-label': `Swatch ${swatch.index}`,
        'data-used-by': String(swatch.used_by),
        'aria-selected': swatch.index === model.primary ? 'true' : 'false',
        class: 'swatch-row',
      });
      const chip = el('span', { class: 'swatch-chip', 'aria-hidden': 'true' });
      chip.style.background = `#${swatch.color.slice(0, 6)}`;
      option.append(
        chip,
        el('span', { class: 'swatch-name', text: `Swatch ${swatch.index}` }),
        el('span', {
          class: 'swatch-count',
          text: `Used by ${num(swatch.used_by)} ${swatch.used_by === 1 ? 'pixel' : 'pixels'}`,
        }),
      );
      option.addEventListener('click', (event) => choose(swatch.index, event.shiftKey));
      option.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || !event.shiftKey) return;
        event.preventDefault();
        choose(swatch.index, true);
      });
      return { label: `Swatch ${swatch.index}`, node: option };
    });
    if (items.length === 0) {
      listbox.append(el('p', { class: 'empty-line', text: 'No swatches yet' }));
    } else {
      for (const item of items) listbox.append(item.node);
      wirePickup({
        container: listbox,
        items,
        announce: (text) => ctx.announceList(text),
        onSelect: (at) => choose(rows[at].index, false),
        onDrop: async (order) => {
          const result = await api.patch<ApiFailure>(`/api/palettes/${model.palette.id}/order`, {
            order: order.map((at) => rows[at].index),
          });
          if (!result.ok) ctx.regions.alert(refusalText(result));
          await ctx.reload();
        },
      });
    }
    const current = rows.find((swatch) => swatch.index === model.primary);
    if (current !== undefined && colourInput.value === '') colourInput.value = current.color;
    addRamp.disabled = model.primary === 0 || model.secondary === 0;
  };

  body.append(
    listbox,
    el('div', { class: 'edit-only panel-controls' }, [
      field('Swatch colour', colourInput),
      el('div', { class: 'row' }, [saveSwatch, addSwatch, removeSwatch]),
      field('Ramp steps', rampSteps),
      addRamp,
      field('Palette file', fileInput),
      importPalette,
    ]),
  );
  refresh();

  return {
    node: el('section', { role: 'region', 'aria-label': 'Palette', class: 'panel panel-mint' }, [
      el('h2', { class: 'panel-title', text: 'Palette' }),
      body,
    ]),
    refresh,
    showCount: (index, shown) => {
      const option = listbox.querySelector(`[aria-label="Swatch ${index}"] .swatch-count`);
      if (option === null) return;
      option.textContent = `Used by ${num(shown)} ${shown === 1 ? 'pixel' : 'pixels'}`;
    },
  };
}

/** The Layers panel: order, opacity, blend, visibility, locks and merging. */
export function layersPanel(ctx: Workspace): Panel {
  const listbox = el('div', { role: 'listbox', 'aria-label': 'Layers', class: 'layer-list' });
  const opacity = el('input', {
    type: 'range',
    role: 'slider',
    'aria-label': 'Layer opacity',
    min: '0',
    max: '100',
    value: '100',
  });
  const blend = combobox('Blend', [
    { value: 'normal', label: 'Normal' },
    { value: 'multiply', label: 'Multiply' },
  ]);
  const visible = checkbox('Layer visible', true);
  const lockButton = button('Lock layer', async () => {
    const model = ctx.model;
    const layer = model.sprite.layers.find((entry) => entry.name === model.activeLayer);
    if (layer === undefined) return;
    const result =
      layer.locked_by === null
        ? await api.post<ApiFailure>(`/api/sprites/${model.spriteId}/layers/${layer.id}/lock`)
        : await api.remove<ApiFailure>(`/api/sprites/${model.spriteId}/layers/${layer.id}/lock`);
    if (!result.ok) ctx.regions.alert(refusalText(result));
    await ctx.reload();
  });
  const mergeButton = button('Merge down', async () => {
    const model = ctx.model;
    const layer = model.sprite.layers.find((entry) => entry.name === model.activeLayer);
    if (layer === undefined) return;
    const result = await api.post<ApiFailure & { new_swatches: number }>(
      `/api/sprites/${model.spriteId}/layers/${layer.id}/merge-down`,
    );
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    await ctx.reload();
  });

  const apply = async (patch: Record<string, unknown>): Promise<void> => {
    const model = ctx.model;
    const layer = model.sprite.layers.find((entry) => entry.name === model.activeLayer);
    if (layer === undefined) return;
    const result = await api.patch<ApiFailure>(
      `/api/sprites/${model.spriteId}/layers/${layer.id}`,
      patch,
    );
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    await ctx.reload();
  };

  opacity.addEventListener('change', () => void apply({ opacity: Number(opacity.value) }));
  blend.addEventListener('change', () => void apply({ blend: blend.value }));
  visible.addEventListener('change', () => void apply({ visible: visible.checked }));

  const refresh = (): void => {
    keepingFocus(listbox, () => refreshNow(), () => {
      (listbox.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();
    });
  };

  const refreshNow = (): void => {
    const model = ctx.model;
    clear(listbox);
    const layers = [...model.sprite.layers].sort((l, r) => l.position - r.position);
    const items = layers.map((layer) => {
      const option = el('div', {
        role: 'option',
        'aria-label': layer.name,
        'aria-selected': layer.name === model.activeLayer ? 'true' : 'false',
        class: 'layer-row',
      });
      option.append(el('span', { text: layer.name }));
      if (layer.locked_by !== null) {
        option.append(el('span', { class: 'lock-note', text: `Locked by ${layer.locked_by}` }));
      }
      return { label: layer.name, node: option };
    });
    for (const item of items) listbox.append(item.node);
    wirePickup({
      container: listbox,
      items,
      announce: (text) => ctx.announceList(text),
      onSelect: (at) => {
        model.activeLayer = layers[at].name;
        refresh();
        ctx.repaint();
      },
      onDrop: async (order) => {
        const moved = order.map((at) => layers[at]);
        for (let position = 0; position < moved.length; position += 1) {
          await api.patch<ApiFailure>(
            `/api/sprites/${model.spriteId}/layers/${moved[position].id}`,
            { position: position + 1 },
          );
        }
        await ctx.reload();
      },
    });
    const active = layers.find((layer) => layer.name === model.activeLayer);
    if (active !== undefined) {
      opacity.value = String(active.opacity);
      blend.value = active.blend;
      visible.checked = active.visible;
      const label = active.locked_by === null ? 'Lock layer' : 'Unlock layer';
      lockButton.textContent = label;
      lockButton.setAttribute('aria-label', label);
    }
  };

  const body = el('div', { class: 'panel-body' }, [
    listbox,
    el('div', { class: 'edit-only panel-controls' }, [
      button('Add layer', async () => {
        const result = await api.post<ApiFailure>(`/api/sprites/${ctx.model.spriteId}/layers`, {});
        if (!result.ok) ctx.regions.alert(refusalText(result));
        await ctx.reload();
      }),
      field('Layer opacity', opacity),
      field('Blend', blend),
      field('Layer visible', visible),
      el('div', { class: 'row' }, [lockButton, mergeButton]),
    ]),
  ]);
  refresh();

  return {
    node: el('section', { role: 'region', 'aria-label': 'Layers', class: 'panel panel-cyan' }, [
      el('h2', { class: 'panel-title', text: 'Layers' }),
      body,
    ]),
    refresh,
  };
}
