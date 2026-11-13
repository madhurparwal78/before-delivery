import { DECK_STATUS, SCREEN_STATES, formatPublishedDate, unitChangedCopy } from '../../shared/copy.js';
import type { SettingsJson, Unit } from '../../shared/types.js';
import { ZONE_NAMES } from '../../shared/zoneNames.js';
import { ApiCallError, api } from '../api.js';
import { element, setText } from '../dom.js';
import type { Screen, ScreenContext } from './screen.js';

/** Settings: the home time zone and the size unit. */
export function renderSettings({ shell }: ScreenContext): Screen {
  const heading = element('h1', {}, ['Settings']);
  const zonePicker = element(
    'select',
    { id: 'home-zone', 'aria-label': 'Home time zone', class: 'zone-picker' },
    ZONE_NAMES.map((zone) => element('option', { value: zone }, [zone])),
  );
  const saveZone = element('button', { type: 'button', class: 'action primary' }, [
    'Save home zone',
  ]);
  const notice = element('p', { class: 'zone-notice' });
  const zoneError = element('p', { class: 'field-error', hidden: true });
  const unitGroup = element('div', {
    role: 'radiogroup',
    'aria-label': 'Size unit',
    class: 'radio-row',
  });
  shell.main.append(
    heading,
    element('div', { class: 'setting' }, [
      element('label', { for: 'home-zone' }, ['Home time zone']),
      zonePicker,
      saveZone,
      notice,
      zoneError,
    ]),
    element('div', { class: 'setting' }, [unitGroup]),
  );
  shell.field.showMessage(SCREEN_STATES.loading);

  let destroyed = false;

  for (const value of ['mm', 'in'] as const) {
    const radioId = `settings-unit-${value}`;
    const input = element('input', {
      id: radioId,
      type: 'radio',
      name: 'settings-unit',
      value,
    });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      shell.setUnit(value);
      shell.setDeckStatus(unitChangedCopy(value));
      void api.saveUnit(value).catch(() => shell.setDeckStatus(DECK_STATUS.genericFailure));
    });
    unitGroup.append(input, element('label', { for: radioId }, [value]));
  }

  function paint(settings: SettingsJson): void {
    zonePicker.value = settings.pending_zone?.zone ?? settings.home_zone;
    setText(
      notice,
      settings.pending_zone
        ? `Your home zone changes to ${settings.pending_zone.zone} at midnight on ${formatPublishedDate(settings.pending_zone.effective_date)} in ${settings.home_zone}.`
        : `Your home zone is ${settings.home_zone}.`,
    );
    setUnitRadios(settings.unit);
    shell.setUnit(settings.unit);
    shell.field.showMessage('Your deck keeps its own clock in your home zone.');
  }

  function setUnitRadios(unit: Unit): void {
    for (const input of unitGroup.querySelectorAll('input')) {
      input.checked = input.value === unit;
    }
  }

  saveZone.addEventListener('click', () => {
    zoneError.hidden = true;
    zonePicker.removeAttribute('aria-invalid');
    void api
      .saveHomeZone(zonePicker.value)
      .then((settings) => {
        paint(settings);
        shell.setDeckStatus(notice.textContent ?? '');
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError && error.status === 422) {
          zoneError.hidden = false;
          setText(zoneError, error.fields.zone ?? DECK_STATUS.validationFailure);
          zonePicker.setAttribute('aria-invalid', 'true');
          shell.setDeckStatus(DECK_STATUS.validationFailure);
          zonePicker.focus();
          return;
        }
        shell.setDeckStatus(DECK_STATUS.genericFailure);
      });
  });

  void api
    .settings()
    .then((settings) => {
      if (!destroyed) paint(settings);
    })
    .catch(() => undefined);

  return {
    destroy() {
      destroyed = true;
    },
  };
}
