import { api, ApiFailure, HubUnreachable, HUB_UNREACHABLE_COPY } from '../api';
import { el, focusFirstIn, openSheet, svgIcon } from '../dom';
import type { Scene, Tint } from '../../shared/types';

const TINT_LABELS: Record<Tint, string> = {
  amber: 'Amber',
  honey: 'Honey',
  ember: 'Ember',
  rose: 'Rose',
  dusk: 'Dusk',
  candle: 'Candle',
};

const TINT_ORDER: Tint[] = ['amber', 'honey', 'ember', 'rose', 'dusk', 'candle'];

export function openSceneSheet(options: {
  scene: Scene | null;
  opener: HTMLElement;
  onSaved: () => void;
}): void {
  const { scene, opener } = options;
  const name = scene ? `Edit ${scene.name}` : 'New scene';
  const sheet = openSheet({ name, opener, className: 'scene-sheet' });
  if (sheet.body.childElementCount > 0) {
    focusFirstIn(sheet);
    return;
  }

  const nameField = el('input', {
    type: 'text',
    class: 'control input',
    id: 'scene-name',
    'aria-label': 'Scene name',
    value: scene?.name ?? '',
  }) as HTMLInputElement;
  const nameError = el('p', { class: 'field-error' });

  const tintGroup = el('div', { class: 'radiogroup', role: 'radiogroup', 'aria-label': 'Tint' });
  for (const tint of TINT_ORDER) {
    const radio = el('input', {
      type: 'radio',
      class: 'control radio',
      name: 'tint',
      value: tint,
      'aria-label': TINT_LABELS[tint],
    }) as HTMLInputElement;
    radio.checked = scene ? scene.tint === tint : tint === 'amber';
    tintGroup.append(
      el('label', { class: `tint-choice tint-${tint}` }, [
        radio,
        el('span', { class: 'swatch' }),
        el('span', {}, [TINT_LABELS[tint]]),
      ]),
    );
  }
  const tintError = el('p', { class: 'field-error' });

  const brightness = el('input', {
    type: 'number',
    class: 'control input num',
    id: 'scene-brightness',
    'aria-label': 'Brightness',
    min: '0',
    max: '100',
    step: '1',
    value: String(scene?.brightness ?? 50),
  }) as HTMLInputElement;
  const brightnessError = el('p', { class: 'field-error' });

  const setpoint = el('input', {
    type: 'number',
    class: 'control input num',
    id: 'scene-setpoint',
    'aria-label': 'Setpoint',
    min: '60',
    max: '80',
    step: '1',
    value: scene?.setpoint_f === null || scene === null ? '' : String(scene.setpoint_f),
  }) as HTMLInputElement;
  const setpointError = el('p', { class: 'field-error' });

  const statusLine = el('p', {
    class: 'status-line',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Scene save',
  });
  const submit = el('button', { type: 'button', class: 'control primary' }, [
    scene ? 'Save scene' : 'Create scene',
  ]);
  const closeButton = el('button', { type: 'button', class: 'control sheet-close' }, [
    svgIcon('x'),
    el('span', {}, ['Close']),
  ]);
  closeButton.addEventListener('click', () => sheet.close());

  sheet.body.replaceChildren(
    el('h2', { class: 'sheet-heading' }, [name]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'scene-name' }, ['Scene name']),
      nameField,
      nameError,
    ]),
    el('div', { class: 'field' }, [el('p', { class: 'field-label' }, ['Tint']), tintGroup, tintError]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'scene-brightness' }, ['Brightness']),
      brightness,
      brightnessError,
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'scene-setpoint' }, ['Setpoint']),
      setpoint,
      setpointError,
    ]),
    statusLine,
    el('div', { class: 'sheet-actions' }, [submit]),
    closeButton,
  );

  submit.addEventListener('click', () => {
    nameError.textContent = '';
    tintError.textContent = '';
    brightnessError.textContent = '';
    setpointError.textContent = '';
    statusLine.textContent = scene ? 'Saving scene…' : 'Creating scene…';
    const chosen = tintGroup.querySelector<HTMLInputElement>('input:checked');
    const body = {
      name: nameField.value,
      tint: chosen ? (chosen.value as Tint) : null,
      brightness: brightness.value === '' ? null : Number(brightness.value),
      setpoint_f: setpoint.value === '' ? null : Number(setpoint.value),
    };
    const request = scene
      ? api.put<{ scene: Scene }>(`/api/scenes/${scene.id}`, body)
      : api.post<{ scene: Scene }>('/api/scenes', body);
    void request
      .then(() => {
        statusLine.textContent = scene
          ? 'Scene saved.'
          : 'Scene created. Add it to a schedule slot to give it rooms.';
        options.onSaved();
      })
      .catch((error: unknown) => {
        if (error instanceof HubUnreachable) {
          statusLine.textContent = HUB_UNREACHABLE_COPY;
          return;
        }
        if (!(error instanceof ApiFailure)) throw error;
        statusLine.textContent = error.message;
        const fields = error.fields ?? {};
        if (fields['name']) nameError.textContent = fields['name'];
        if (fields['tint']) tintError.textContent = fields['tint'];
        if (fields['brightness']) brightnessError.textContent = fields['brightness'];
        if (fields['setpoint_f']) setpointError.textContent = fields['setpoint_f'];
      });
  });

  focusFirstIn(sheet);
}
