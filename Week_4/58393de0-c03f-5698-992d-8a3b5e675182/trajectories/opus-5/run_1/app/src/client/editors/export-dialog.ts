import type { CircuitComponent, CircuitWire, ProjectKind, SceneObject } from '../../shared/types.js';
import { UI_COPY } from '../../shared/copy.js';
import { api } from '../api.js';
import { el } from '../dom.js';
import { openDialog } from '../dialog.js';
import { say } from '../status.js';
import { addNotice } from '../notice.js';
import { exportInWorker } from '../geom/worker-client.js';
import { exportFileName, MM_PER_INCH } from '../export/files.js';
import { objectBox, selectionBox } from '../geom/scene.js';
import type { Box } from '../geom/mesh.js';

export interface ExportSource {
  kind: ProjectKind;
  projectId: () => string | null;
  projectName: () => string;
  objects: () => SceneObject[];
  circuit?: () => { components: CircuitComponent[]; wires: CircuitWire[] };
}

export const exportStateElement = (): HTMLElement =>
  el('div', {
    id: 'qy-export',
    class: 'qy-sr-only',
    'data-state': 'idle',
    'data-format': 'stl',
    'data-unit': 'mm',
    'data-triangle-count': '',
    'data-bytes': '',
  });

const designBox = (objects: SceneObject[]): Box | null => {
  const solids = objects.filter((object) => object.mode === 'solid');
  if (solids.length === 0) return null;
  return selectionBox(solids, new Map(solids.map((object) => [object.id, objectBox(object, new Map())])));
};

const sizeLine = (source: ExportSource, unit: 'mm' | 'in'): string => {
  if (source.kind === 'circuit') return UI_COPY.sizeLineCircuit;
  const box = designBox(source.objects());
  if (!box) return UI_COPY.nothingToExport3d;
  const divisor = unit === 'in' ? MM_PER_INCH : 1;
  const decimals = unit === 'in' ? 2 : 1;
  const parts = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]].map((value) =>
    (value / divisor).toFixed(decimals),
  );
  return UI_COPY.sizeLine3d(parts[0], parts[1], parts[2], unit);
};

const canExport = (source: ExportSource): boolean => {
  if (source.kind === 'circuit') return (source.circuit?.().components.length ?? 0) > 0;
  return designBox(source.objects()) !== null;
};

const radio = (
  group: string,
  value: string,
  label: string,
  checked: boolean,
  disabled: boolean,
): { wrapper: HTMLElement; input: HTMLInputElement } => {
  const input = el('input', {
    type: 'radio',
    name: group,
    id: `${group}-${value}`,
    value,
    checked,
    disabled,
  });
  input.checked = checked;
  input.disabled = disabled;
  return {
    wrapper: el('div', { class: 'qy-radio' }, [input, el('label', { for: `${group}-${value}`, text: label })]),
    input,
  };
};

/** The Export dialog: format, unit, the size line, then a build in the Web Worker. */
export const openExportDialog = (source: ExportSource, opener: HTMLElement, onExported: () => void): void => {
  const state = document.getElementById('qy-export');
  const circuit = source.kind === 'circuit';
  if (state) {
    state.dataset.state = 'idle';
    state.dataset.format = circuit ? 'svg' : 'stl';
    state.dataset.unit = 'mm';
    state.dataset.triangleCount = '';
    state.dataset.bytes = '';
  }

  openDialog({ label: 'Export', opener }, (dialog) => {
    const stl = radio('Format', 'stl', 'STL', !circuit, circuit);
    const obj = radio('Format', 'obj', 'OBJ', false, circuit);
    const svg = radio('Format', 'svg', 'SVG', circuit, false);
    const mm = radio('Unit', 'mm', 'Millimetres', true, false);
    const inches = radio('Unit', 'in', 'Inches', false, circuit);
    const line = el('p', { class: 'qy-figures qy-size-line' });
    const download = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Download' });
    const cancel = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Cancel' });
    cancel.addEventListener('click', dialog.close);

    const formatOf = (): 'stl' | 'obj' | 'svg' => (stl.input.checked ? 'stl' : obj.input.checked ? 'obj' : 'svg');
    const unitOf = (): 'mm' | 'in' => (inches.input.checked ? 'in' : 'mm');

    const refresh = (): void => {
      const unit = unitOf();
      if (!canExport(source)) {
        line.textContent = circuit ? UI_COPY.nothingToExportCircuit : UI_COPY.nothingToExport3d;
        download.disabled = true;
        return;
      }
      download.disabled = false;
      line.textContent = sizeLine(source, unit);
    };

    for (const control of [stl.input, obj.input, svg.input, mm.input, inches.input]) {
      control.addEventListener('change', refresh);
    }

    download.addEventListener('click', () => {
      void (async () => {
        const format = formatOf();
        const unit = unitOf();
        const fileName = exportFileName(source.projectName(), format);
        if (state) {
          state.dataset.state = 'working';
          state.dataset.format = format;
          state.dataset.unit = unit;
        }
        say(UI_COPY.preparing(fileName));
        const circuitData = source.circuit?.();
        const built = await exportInWorker({
          format,
          unit,
          name: source.projectName(),
          objects: source.objects(),
          components: circuit ? circuitData?.components : undefined,
          wires: circuit ? circuitData?.wires : undefined,
        });
        if (!built.ok || !built.bytes) {
          if (state) state.dataset.state = 'failed';
          say(built.reason === 'mesh_not_closed' ? 'Export failed: the mesh is not closed.' : UI_COPY.nothingToExport3d);
          return;
        }
        const stored = await api.uploadExport(
          { format, unit, name: fileName, projectId: source.projectId() },
          built.bytes,
        );
        if (!stored.ok) {
          if (state) state.dataset.state = 'failed';
          if (stored.code === 'storage_unavailable') {
            say(UI_COPY.exportStorageDown);
            addNotice({ id: 'export-failed', text: UI_COPY.exportStorageDown });
          } else {
            say(stored.message);
          }
          return;
        }
        if (state) {
          state.dataset.state = 'done';
          state.dataset.format = format;
          state.dataset.unit = unit;
          state.dataset.triangleCount = stored.value.triangleCount === null ? '' : String(stored.value.triangleCount);
          state.dataset.bytes = String(stored.value.bytes);
        }
        dialog.close();
        say(UI_COPY.exported(fileName, unit === 'in' ? 'inches' : 'millimetres'));
        say(UI_COPY.exportStored);
        onExported();
        const blob = await fetch(stored.value.downloadUrl, { credentials: 'same-origin' }).then((response) =>
          response.blob(),
        );
        const url = URL.createObjectURL(blob);
        const anchor = el('a', { href: url, download: fileName });
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      })();
    });

    refresh();
    return [
      el('h2', { class: 'qy-dialog-heading', text: 'Export' }),
      el('fieldset', { class: 'qy-radiogroup', role: 'radiogroup', 'aria-label': 'Format' }, [
        el('legend', { text: 'Format' }),
        stl.wrapper,
        obj.wrapper,
        svg.wrapper,
      ]),
      el('fieldset', { class: 'qy-radiogroup', role: 'radiogroup', 'aria-label': 'Unit' }, [
        el('legend', { text: 'Unit' }),
        mm.wrapper,
        inches.wrapper,
      ]),
      line,
      el('div', { class: 'qy-dialog-actions' }, [download, cancel]),
    ];
  });
};
