import { ERRORS, PENDING, SUCCESS } from '../../shared/copy';
import { panelDiagramSvg } from '../../shared/diagram';
import { PANELS, isGaugeable } from '../../shared/panels';
import type { PanelsResponse } from '../../shared/types';
import { ApiRefusal, request } from '../shared/api';
import { el, onPress, setPending, svgFrom } from '../shared/dom';
import { announce } from '../shared/live';
import { gaugeText, onUnitsChange } from '../shared/units';
import { dataTable, sectionShell, showFieldError, type SectionContext, type SectionView } from './sectionKit';
import type { CarFileState } from './state';
import { ownerAction, sessionEnded } from './session';

/** Panels and readings: the panel list beside the top-down panel diagram. */
export const panelsSection = (context: SectionContext): SectionView => {
  const { section, heading } = sectionShell('panels', 'Panels and readings');

  const diagram = el('div', { class: 'diagram-holder', role: 'img', 'aria-label': 'Panel diagram' });
  const body = el('tbody', { role: 'rowgroup' });
  const table = dataTable('Panel readings', ['Panel', 'Microns', 'Band'], body);
  const save = el('button', { type: 'button', class: 'pill-solid', text: 'Save readings' });

  const inputs = new Map<string, HTMLInputElement>();
  const errors = new Map<string, HTMLElement>();

  for (const panel of PANELS) {
    const gaugeable = isGaugeable(panel);
    const error = el('p', { class: 'field-error' });
    error.hidden = true;
    errors.set(panel.id, error);

    const valueCell = el('td', { class: 'reading-cell', role: 'cell' });
    if (gaugeable) {
      const input = el('input', {
        type: 'number',
        class: 'spin-input figures',
        min: '1',
        max: '2000',
        step: '1',
      }) as HTMLInputElement;
      input.setAttribute('aria-label', `Microns for ${panel.label}`);
      inputs.set(panel.id, input);
      valueCell.append(input, error);
    } else {
      valueCell.append(el('span', { class: 'band-word', text: 'Not gauged' }));
    }

    body.append(
      el('tr', { class: 'reading-row', role: 'row', 'data-panel-id': panel.id }, [
        el('td', { class: 'panel-label', role: 'cell', text: panel.label }),
        valueCell,
        el('td', { class: 'band-cell', role: 'cell' }, [el('span', { class: 'band-word' })]),
      ]),
    );
  }

  const paintDiagram = (state: CarFileState): void => {
    diagram.replaceChildren(
      svgFrom(
        panelDiagramSvg({
          pins: state.findings.map((finding) => ({
            panelId: finding.panelId,
            u: finding.u,
            v: finding.v,
            label: finding.title,
            kind: 'finding' as const,
          })),
          activePanelId: null,
          interactive: false,
        }),
      ),
    );
  };

  const paintFigures = (panels: PanelsResponse): void => {
    for (const panel of PANELS) {
      const dto = panels.panels.find((candidate) => candidate.id === panel.id);
      const rowNode = body.querySelector<HTMLElement>(`[data-panel-id="${panel.id}"] .band-word`);
      if (rowNode !== null) {
        rowNode.textContent =
          dto?.owner?.band ?? (isGaugeable(panel) ? 'No reading' : 'Not gauged');
      }
      const input = inputs.get(panel.id);
      if (input === undefined || document.activeElement === input) continue;
      const owner = dto?.owner ?? null;
      input.value = owner === null ? '' : String(owner.microns);
      input.dataset.gauge = owner === null ? '' : gaugeText(owner.microns, owner.mils);
    }
  };

  onUnitsChange(() => paintFigures(context.state().panels));

  onPress(save, () => {
    void ownerAction(async () => {
      setPending(save, true);
      announce(context.status, PENDING.saveReadings);
      for (const error of errors.values()) showFieldError(error, undefined);
      const readings = [...inputs]
        .filter(([, input]) => input.value.trim().length > 0)
        .map(([panelId, input]) => ({ panelId, microns: Number(input.value) }));
      try {
        await request<PanelsResponse>(`/api/owner/cars/${context.carId}/readings`, {
          method: 'PUT',
          body: { readings },
        });
        await context.refresh(['panels', 'publish', 'findings']);
        announce(context.status, SUCCESS.saveReadings);
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal && error.body.errors !== undefined) {
          for (const [panelId, message] of Object.entries(error.body.errors)) {
            showFieldError(errors.get(panelId) ?? el('p'), message);
            announce(context.status, message);
          }
          return;
        }
        if (error instanceof ApiRefusal) {
          announce(context.status, error.code === 'listing_closed' ? ERRORS.listingClosed : error.body.message);
          return;
        }
        throw error;
      } finally {
        setPending(save, false);
      }
    }, save);
  });

  section.append(el('div', { class: 'panels-layout' }, [diagram, el('div', { class: 'card' }, [table, save])]));

  return {
    id: 'panels',
    heading,
    node: section,
    paint: (state) => {
      paintFigures(state.panels);
      paintDiagram(state);
    },
  };
};
