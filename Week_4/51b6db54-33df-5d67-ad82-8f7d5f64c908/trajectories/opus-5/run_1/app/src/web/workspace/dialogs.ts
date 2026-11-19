import { rankCommands, type CommandItem } from '../../shared/commands.js';
import { api, refusalText, type ApiFailure } from '../api.js';
import { button, clear, combobox, el, field, spinbutton, textbox, trapDialog } from '../dom.js';
import { num } from '../session.js';
import type { Workspace } from './context.js';

/** The Export dialog, whose job progress stays in place while the job runs. */
export function openExportDialog(ctx: Workspace): void {
  const format = combobox('Format', [
    { value: 'png', label: 'PNG' },
    { value: 'gif', label: 'GIF' },
    { value: 'sheet', label: 'Sheet' },
  ]);
  const scale = spinbutton('Scale', 1, { min: '1', max: '16' });
  const frame = spinbutton('Export frame', ctx.model.activeFrame, { min: '1' });
  const padding = spinbutton('Padding', 0, { min: '0', max: '64' });
  const extrude = spinbutton('Extrude', 0, { min: '0', max: '16' });
  const label = textbox('Export label');
  const status = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Job progress',
    class: 'live-region',
  });
  const cancelHost = el('div', { class: 'row' });

  const dialog = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Export',
    class: 'dialog',
  });
  const shade = el('div', { class: 'shade' }, [dialog]);
  let release: (() => void) | null = null;
  const close = (): void => {
    release?.();
    shade.remove();
  };

  const watch = (jobId: number): void => {
    clear(cancelHost);
    cancelHost.append(
      button('Cancel job', async () => {
        const stopped = await api.post<ApiFailure>(`/api/jobs/${jobId}/cancel`);
        if (!stopped.ok) ctx.regions.alert(refusalText(stopped));
      }),
    );
    status.textContent = 'Processing 0 of 0';
    const source = new EventSource(`/api/jobs/${jobId}/events`, { withCredentials: true });
    source.onmessage = (event) => {
      const message = JSON.parse(event.data) as {
        state: string;
        done: number;
        total: number;
        files: { name: string }[];
      };
      if (message.state === 'queued' || message.state === 'rendering') {
        status.textContent = `Processing ${num(message.done)} of ${num(message.total)}`;
        return;
      }
      if (message.state === 'cancelled') {
        status.textContent = `Cancelled at ${num(message.done)} of ${num(message.total)}: nothing stored`;
      } else if (message.state === 'failed') {
        status.textContent = 'Export failed: nothing stored';
      } else {
        status.textContent = `Stored: ${message.files.map((file) => file.name).join(', ')}`;
      }
      clear(cancelHost);
      source.close();
    };
  };

  dialog.append(
    el('h2', { text: 'Export' }),
    field('Format', format),
    field('Scale', scale),
    field('Export frame', frame),
    field('Padding', padding),
    field('Extrude', extrude),
    field('Export label', label),
    el('div', { class: 'row' }, [
      button('Start export', async () => {
        const body: Record<string, unknown> = {
          format: format.value,
          scale: Number(scale.value),
          label: label.value.trim(),
        };
        if (format.value === 'png') body.frame = Number(frame.value);
        if (format.value === 'sheet') {
          body.padding = Number(padding.value);
          body.extrude = Number(extrude.value);
        }
        const result = await api.post<ApiFailure & { job: number }>(
          `/api/sprites/${ctx.model.spriteId}/exports`,
          body,
        );
        if (!result.ok) {
          const text = refusalText(result);
          ctx.regions.alert(
            result.body.error === 'storage_unavailable'
              ? 'Storage is unavailable. Your artwork is safe.'
              : text,
          );
          return;
        }
        watch(result.body.job);
      }),
      button('Close', close),
    ]),
    status,
    cancelHost,
  );
  document.body.append(shade);
  release = trapDialog(dialog, close);
}

/** The command palette, ranked by the published score. */
export function openCommandPalette(ctx: Workspace): void {
  const query = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Command',
    'aria-expanded': 'true',
    autocomplete: 'off',
  });
  const listbox = el('div', { role: 'listbox', 'aria-label': 'Commands', class: 'command-list' });
  const dialog = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Command palette',
    class: 'dialog',
  });
  const shade = el('div', { class: 'shade' }, [dialog]);
  let release: (() => void) | null = null;
  const close = (): void => {
    release?.();
    shade.remove();
  };

  const items = (): CommandItem[] => {
    const model = ctx.model;
    const tools: CommandItem[] = [
      'Pencil',
      'Eraser',
      'Line',
      'Rectangle',
      'Ellipse',
      'Fill',
      'Dither',
      'Selection',
      'Picker',
    ].map((tool) => ({ name: `Tool: ${tool}`, kind: 'tool', value: tool.toLowerCase() }));
    const layers: CommandItem[] = model.sprite.layers.map((layer) => ({
      name: `Layer: ${layer.name}`,
      kind: 'layer',
      value: layer.name,
    }));
    const frames: CommandItem[] = model.sprite.frames.map((entry) => ({
      name: `Frame ${entry.number}`,
      kind: 'frame',
      value: String(entry.number),
    }));
    const swatches: CommandItem[] = model.palette.swatches.map((swatch) => ({
      name: `Swatch ${swatch.index}`,
      kind: 'swatch',
      value: String(swatch.index),
    }));
    return [...tools, ...layers, ...frames, ...swatches];
  };

  let active = 0;
  let shown = rankCommands(items(), '');

  const draw = (): void => {
    clear(listbox);
    if (shown.length === 0) {
      listbox.append(el('p', { class: 'empty-line', text: 'No matching commands' }));
      query.removeAttribute('aria-activedescendant');
      return;
    }
    shown.forEach((item, at) => {
      const id = `command-${at}`;
      const option = el('div', {
        role: 'option',
        id,
        'aria-selected': at === active ? 'true' : 'false',
        class: at === active ? 'command-row at' : 'command-row',
        text: item.name,
      });
      option.addEventListener('click', () => run(at));
      listbox.append(option);
    });
    query.setAttribute('aria-activedescendant', `command-${active}`);
  };

  const run = (at: number): void => {
    const item = shown[at];
    if (item === undefined) return;
    const model = ctx.model;
    if (item.kind === 'tool') {
      model.tool = item.value as typeof model.tool;
      ctx.announceStage(`Tool: ${item.name.replace('Tool: ', '')}`);
    } else if (item.kind === 'layer') {
      model.activeLayer = item.value;
    } else if (item.kind === 'frame') {
      model.activeFrame = Number(item.value);
      ctx.announceStage(`Frame ${model.activeFrame} of ${num(model.sprite.frames.length)}`);
    } else {
      model.primary = Number(item.value);
    }
    close();
    ctx.repaint();
    ctx.refreshPanels();
  };

  query.addEventListener('input', () => {
    shown = rankCommands(items(), query.value.trim());
    active = 0;
    draw();
  });
  query.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(active + 1, shown.length - 1);
      draw();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(active - 1, 0);
      draw();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      run(active);
    }
  });

  dialog.append(el('h2', { text: 'Command palette' }), field('Command', query), listbox);
  draw();
  document.body.append(shade);
  release = trapDialog(dialog, close);
}
