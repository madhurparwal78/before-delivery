import { EMPTY, ERRORS, PENDING, SEVERITY_WORD, SUCCESS } from '../../shared/copy';
import { panelDiagramSvg } from '../../shared/diagram';
import { PANELS, panelById } from '../../shared/panels';
import type { FindingDto, Severity } from '../../shared/types';
import { ApiRefusal, request } from '../shared/api';
import { el, focusTarget, onPress, setPending, svgFrom } from '../shared/dom';
import { announce } from '../shared/live';
import { Stage } from '../stage/stage';
import { sectionShell, showFieldError, type SectionContext, type SectionView } from './sectionKit';
import { ownerAction, sessionEnded } from './session';
import type { CarFileState } from './state';

const ARROW_STEP = 0.01;
const ARROW_SHIFT_STEP = 0.05;

/** Findings: the stage preview above the finding form, with the panel list and pin. */
export const findingsSection = (context: SectionContext): SectionView => {
  const { section, heading } = sectionShell('findings', 'Findings');

  const stage = new Stage({ kind: 'preview', carName: context.state().car.name });

  const panelOptions = el('div', { class: 'panel-listbox', role: 'listbox', 'aria-label': 'Panels', tabindex: '0' });
  const diagram = el('div', { class: 'diagram-holder', role: 'img', 'aria-label': 'Panel diagram' });
  const pin = el('button', { type: 'button', class: 'finding-pin', text: 'Finding pin' });
  pin.setAttribute('aria-label', 'Finding pin');

  const title = el('input', { type: 'text', class: 'text-input', id: 'finding-title' }) as HTMLInputElement;
  title.setAttribute('aria-label', 'Finding title');
  const wording = el('textarea', { class: 'text-input', id: 'finding-wording', rows: 3 }) as HTMLTextAreaElement;
  wording.setAttribute('aria-label', 'Finding wording');
  const severity = el('select', { class: 'select-input', id: 'finding-severity' }) as HTMLSelectElement;
  severity.setAttribute('aria-label', 'Severity');
  for (const value of ['cosmetic', 'moderate', 'serious'] as const) {
    severity.append(el('option', { value, text: SEVERITY_WORD[value] }));
  }
  const photo = el('select', { class: 'select-input', id: 'finding-photo' }) as HTMLSelectElement;
  photo.setAttribute('aria-label', 'Finding photo');
  const save = el('button', { type: 'button', class: 'pill-solid', text: 'Save finding' });
  const titleError = el('p', { class: 'field-error' });
  titleError.hidden = true;
  const wordingError = el('p', { class: 'field-error' });
  wordingError.hidden = true;

  const list = el('ul', { class: 'finding-list', role: 'list', 'aria-label': 'Findings' });

  let chosenPanelId: string | null = null;
  let anchor = { u: 0.5, v: 0.5 };
  let editing: { id: string; revision: number } | null = null;

  const announcePin = (): void => {
    const panel = (chosenPanelId === null ? null : panelById(chosenPanelId)) ?? null;
    if (panel === null) return;
    announce(
      context.status,
      `${panel.label} at ${Math.round(anchor.u * 100)} across, ${Math.round(anchor.v * 100)} down`,
    );
  };

  const paintDiagram = (): void => {
    const pins =
      chosenPanelId === null
        ? context.state().findings.map((finding) => ({
            panelId: finding.panelId,
            u: finding.u,
            v: finding.v,
            label: finding.title,
            kind: 'finding' as const,
          }))
        : [{ panelId: chosenPanelId, u: anchor.u, v: anchor.v, label: 'Finding pin', kind: 'placing' as const }];
    diagram.replaceChildren(
      svgFrom(panelDiagramSvg({ pins, activePanelId: chosenPanelId, interactive: true })),
    );
    const svg = diagram.firstElementChild;
    if (svg === null) return;
    svg.addEventListener('click', (event) => {
      const target = event.target as Element;
      const rect = target.closest<SVGRectElement>('[data-panel-id]');
      if (rect === null) return;
      event.preventDefault();
      const panelId = rect.dataset.panelId;
      if (panelId === undefined) return;
      const box = rect.getBoundingClientRect();
      const pointer = event as MouseEvent;
      choosePanel(panelId, {
        u: Math.min(1, Math.max(0, (pointer.clientX - box.left) / box.width)),
        v: Math.min(1, Math.max(0, (pointer.clientY - box.top) / box.height)),
      });
      announcePin();
    });
  };

  const updatePreview = (): void => {
    if (chosenPanelId === null) {
      stage.setRestOverride(null);
      return;
    }
    stage.setRestOverride({ id: 'unsaved-pin', panelId: chosenPanelId, u: anchor.u, v: anchor.v });
  };

  const choosePanel = (panelId: string, at: { u: number; v: number } = { u: 0.5, v: 0.5 }): void => {
    chosenPanelId = panelId;
    anchor = at;
    for (const option of panelOptions.querySelectorAll<HTMLElement>('[role="option"]')) {
      const selected = option.dataset.panelId === panelId;
      option.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) panelOptions.setAttribute('aria-activedescendant', option.id);
    }
    paintDiagram();
    updatePreview();
  };

  for (const panel of PANELS) {
    const option = el('div', {
      class: 'panel-option',
      role: 'option',
      id: `panel-option-${panel.id}`,
      'data-panel-id': panel.id,
      'aria-selected': 'false',
      text: panel.label,
    });
    option.addEventListener('click', () => {
      choosePanel(panel.id);
      announcePin();
    });
    panelOptions.append(option);
  }

  panelOptions.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = chosenPanelId === null ? -1 : PANELS.findIndex((panel) => panel.id === chosenPanelId);
    const next = event.key === 'ArrowDown' ? Math.min(PANELS.length - 1, index + 1) : Math.max(0, index - 1);
    choosePanel(PANELS[next].id);
    announcePin();
  });

  pin.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? ARROW_SHIFT_STEP : ARROW_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move === undefined || chosenPanelId === null) return;
    event.preventDefault();
    anchor = {
      u: Math.min(1, Math.max(0, Number((anchor.u + move[0]).toFixed(3)))),
      v: Math.min(1, Math.max(0, Number((anchor.v + move[1]).toFixed(3)))),
    };
    paintDiagram();
    updatePreview();
    announcePin();
  });

  const paintPhotoOptions = (state: CarFileState): void => {
    const current = photo.value;
    photo.replaceChildren(el('option', { value: '', text: 'No photo' }));
    for (const upload of state.uploads) {
      if (upload.kind !== 'photo') continue;
      photo.append(el('option', { value: upload.id, text: upload.fileName }));
    }
    photo.value = current;
  };

  const resetForm = (): void => {
    editing = null;
    chosenPanelId = null;
    anchor = { u: 0.5, v: 0.5 };
    title.value = '';
    wording.value = '';
    severity.value = 'cosmetic';
    photo.value = '';
    for (const option of panelOptions.querySelectorAll<HTMLElement>('[role="option"]')) {
      option.setAttribute('aria-selected', 'false');
    }
    paintDiagram();
    updatePreview();
  };

  onPress(save, () => {
    void ownerAction(async () => {
      setPending(save, true);
      announce(context.status, PENDING.saveFinding);
      showFieldError(titleError, undefined);
      showFieldError(wordingError, undefined);
      const body = {
        panelId: chosenPanelId ?? '',
        u: anchor.u,
        v: anchor.v,
        title: title.value,
        wording: wording.value,
        severity: severity.value as Severity,
        photoId: photo.value === '' ? null : photo.value,
      };
      try {
        if (editing === null) {
          await request<FindingDto>(`/api/owner/cars/${context.carId}/findings`, { method: 'POST', body });
        } else {
          await request<FindingDto>(`/api/owner/cars/${context.carId}/findings/${editing.id}`, {
            method: 'PATCH',
            body,
            ifMatch: editing.revision,
          });
        }
        resetForm();
        await context.refresh(['findings', 'publish']);
        announce(context.status, SUCCESS.saveFinding);
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal) {
          if (error.code === 'stale_finding') {
            announce(context.status, ERRORS.staleFinding);
            await context.refresh(['findings']);
            return;
          }
          if (error.body.errors !== undefined) {
            showFieldError(titleError, error.body.errors.title);
            showFieldError(wordingError, error.body.errors.wording);
            for (const message of Object.values(error.body.errors)) announce(context.status, message);
            return;
          }
          announce(context.status, error.code === 'listing_closed' ? ERRORS.listingClosed : error.body.message);
          return;
        }
        throw error;
      } finally {
        setPending(save, false);
      }
    }, save);
  });

  const removeFinding = (finding: FindingDto, control: HTMLElement): void => {
    void ownerAction(async () => {
      setPending(control, true);
      announce(context.status, PENDING.removeFinding);
      try {
        await request(`/api/owner/cars/${context.carId}/findings/${finding.id}`, {
          method: 'DELETE',
          ifMatch: finding.revision,
        });
        await context.refresh(['findings', 'publish']);
        announce(context.status, SUCCESS.removeFinding);
        focusTarget(heading);
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal) {
          announce(
            context.status,
            error.code === 'stale_finding'
              ? ERRORS.staleFinding
              : error.code === 'listing_closed'
                ? ERRORS.listingClosed
                : error.body.message,
          );
          return;
        }
        throw error;
      } finally {
        if (control.isConnected) setPending(control, false);
      }
    }, control);
  };

  const paintList = (state: CarFileState): void => {
    if (state.findings.length === 0) {
      list.replaceChildren(el('li', { class: 'empty-line', text: EMPTY.findings }));
      return;
    }
    list.replaceChildren(
      ...state.findings.map((finding) => {
        const edit = el('button', { type: 'button', class: 'pill-outline', text: `Edit ${finding.title}` });
        const remove = el('button', { type: 'button', class: 'pill-outline', text: `Remove ${finding.title}` });
        onPress(edit, () => {
          editing = { id: finding.id, revision: finding.revision };
          title.value = finding.title;
          wording.value = finding.wording;
          severity.value = finding.severity;
          photo.value = finding.photoId ?? '';
          choosePanel(finding.panelId, { u: finding.u, v: finding.v });
          focusTarget(title);
        });
        onPress(remove, () => removeFinding(finding, remove));
        return el('li', { class: 'finding-list-item' }, [
          el('span', { class: 'finding-position figures', text: String(finding.position) }),
          el('span', { class: 'finding-list-title', text: finding.title }),
          el('span', { class: 'finding-list-panel', text: finding.panelLabel }),
          el('span', { class: 'finding-list-band', text: finding.band }),
          el('span', { class: 'finding-list-severity', text: SEVERITY_WORD[finding.severity] }),
          edit,
          remove,
        ]);
      }),
    );
  };

  section.append(
    stage.region,
    el('div', { class: 'finding-form card' }, [
      el('div', { class: 'finding-place' }, [
        el('div', {}, [el('p', { class: 'field-label', text: 'Panels' }), panelOptions]),
        el('div', {}, [diagram, pin]),
      ]),
      el('label', { class: 'field-label', for: 'finding-title', text: 'Finding title' }),
      title,
      titleError,
      el('label', { class: 'field-label', for: 'finding-wording', text: 'Finding wording' }),
      wording,
      wordingError,
      el('label', { class: 'field-label', for: 'finding-severity', text: 'Severity' }),
      severity,
      el('label', { class: 'field-label', for: 'finding-photo', text: 'Finding photo' }),
      photo,
      save,
    ]),
    list,
  );

  paintDiagram();

  return {
    id: 'findings',
    heading,
    node: section,
    paint: (state) => {
      paintPhotoOptions(state);
      paintList(state);
      stage.setTrack(
        state.findings.map((finding) => ({
          id: finding.id,
          panelId: finding.panelId,
          u: finding.u,
          v: finding.v,
        })),
        workingHeroId(state.findings),
      );
      stage.setOpenAdvisories(state.car.workingOpenAdvisories);
      stage.setListing(state.car.listingStatus);
    },
  };
};

/** The working hero: the highest severity, with a tie going to the earliest position. */
const workingHeroId = (findings: readonly FindingDto[]): string | null => {
  const rank = { cosmetic: 0, moderate: 1, serious: 2 } as const;
  let hero: FindingDto | null = null;
  for (const finding of findings) {
    if (hero === null || rank[finding.severity] > rank[hero.severity]) hero = finding;
  }
  return hero?.id ?? null;
};
