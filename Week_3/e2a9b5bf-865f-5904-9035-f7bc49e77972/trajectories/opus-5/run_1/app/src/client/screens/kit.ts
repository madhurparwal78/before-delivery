import { TIME_ZONES } from '../../shared/clock.js';
import { GLOBAL_COPY, kitAdded } from '../../shared/messages.js';
import { apertureToMm, formatAperture } from '../../shared/optics.js';
import type { Barlow, Eyepiece, Site, Telescope } from '../../shared/types.js';
import { api, type ValidationBody } from '../api.js';
import { workingScreen } from '../chrome.js';
import { el, labelledField, select, setStatus } from '../dom.js';
import { prefetchAccount } from '../prefetch.js';
import { regions } from '../regions.js';
import { appState, defaultDeviceName, setDeviceName } from '../state.js';

function numberBox(name: string, step = 'any'): HTMLInputElement {
  return el('input', {
    class: 'input',
    attrs: { type: 'number', step, 'aria-label': name, autocomplete: 'off' },
  });
}

function textBox(name: string): HTMLInputElement {
  return el('input', {
    class: 'input',
    attrs: { type: 'text', 'aria-label': name, autocomplete: 'off' },
  });
}

interface FormSpec {
  submitLabel: string;
  accent?: boolean;
  fields: HTMLElement[];
  controls: Array<HTMLInputElement | HTMLSelectElement>;
  firstField: HTMLElement;
  path: string;
  payload: () => Record<string, unknown>;
  name: () => string;
  fieldFor: (key: string) => HTMLElement | null;
}

function addForm(spec: FormSpec, afterAdd: () => void): HTMLFormElement {
  const submit = el('button', {
    class: spec.accent ? 'button accent' : 'button',
    text: spec.submitLabel,
    attrs: { type: 'submit' },
  });
  const form = el('form', { class: 'form kit-form' }, [...spec.fields, submit]);
  let inFlight = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      const name = spec.name();
      const answer = await api.post<ValidationBody>(spec.path, spec.payload());
      inFlight = false;
      if (answer.offline) {
        setStatus(regions.kitStatus, GLOBAL_COPY.needs_signal);
        return;
      }
      if (answer.status === 201) {
        setStatus(regions.kitStatus, kitAdded(name));
        for (const control of spec.controls) {
          if (control instanceof HTMLInputElement) control.value = '';
        }
        (spec.firstField as HTMLElement).focus();
        afterAdd();
        return;
      }
      if (answer.status === 422) {
        const problems = answer.body?.fields ?? {};
        const first = Object.keys(problems)[0];
        setStatus(regions.kitStatus, first ? (problems[first] as string) : '');
        if (first) (spec.fieldFor(first) as HTMLElement | null)?.focus();
        return;
      }
      setStatus(regions.kitStatus, GLOBAL_COPY.internal);
    })();
  });
  return form;
}

function kitList(
  telescopes: Telescope[],
  eyepieces: Eyepiece[],
  barlows: Barlow[],
  sites: Site[],
): HTMLElement {
  const rows: HTMLElement[] = [];
  for (const telescope of telescopes) {
    rows.push(
      el('li', { class: 'row' }, [
        el('span', { class: 'row-name', text: telescope.name }),
        el('span', {
          class: 'row-detail',
          text: `${formatAperture(telescope.aperture_mm)} mm aperture · ${telescope.focal_length_mm} mm focal length`,
        }),
      ]),
    );
  }
  for (const eyepiece of eyepieces) {
    rows.push(
      el('li', { class: 'row' }, [
        el('span', { class: 'row-name', text: eyepiece.name }),
        el('span', {
          class: 'row-detail',
          text: `${eyepiece.focal_length_mm} mm · ${eyepiece.apparent_field_deg}° apparent field`,
        }),
      ]),
    );
  }
  for (const barlow of barlows) {
    rows.push(
      el('li', { class: 'row' }, [
        el('span', { class: 'row-name', text: barlow.name }),
        el('span', { class: 'row-detail', text: `${barlow.factor.toFixed(1)}×` }),
      ]),
    );
  }
  for (const site of sites) {
    rows.push(
      el('li', { class: 'row' }, [
        el('span', { class: 'row-name', text: site.name }),
        el('span', {
          class: 'row-detail',
          text: `${site.latitude}, ${site.longitude} · ${site.time_zone}`,
        }),
      ]),
    );
  }
  return el('ul', { class: 'list', attrs: { 'aria-label': 'Your kit' } }, rows);
}

export async function renderKit(): Promise<HTMLElement> {
  const { root, content } = workingScreen('Kit');
  const status = el('div', {
    class: 'status-line',
    attrs: { role: 'status', 'aria-label': 'Kit status', 'aria-live': 'polite' },
  });
  regions.kitStatus = status;

  const telescopeName = textBox('Telescope name');
  const aperture = numberBox('Aperture');
  const apertureUnit = select(
    'Aperture unit',
    [
      { value: 'mm', label: 'mm' },
      { value: 'in', label: 'in' },
    ],
    'mm',
  );
  const telescopeFocal = numberBox('Focal length (mm)');
  const apertureMm = el('div', {
    class: 'status-line',
    attrs: { role: 'status', 'aria-label': 'Aperture in millimetres', 'aria-live': 'polite' },
  });
  const paintApertureMm = (): void => {
    const value = Number(aperture.value);
    const unit = apertureUnit.value === 'in' ? 'in' : 'mm';
    if (aperture.value.trim() === '' || !Number.isFinite(value)) {
      setStatus(apertureMm, '');
      return;
    }
    setStatus(apertureMm, `${formatAperture(apertureToMm(value, unit))} mm`);
  };
  aperture.addEventListener('input', paintApertureMm);
  apertureUnit.addEventListener('change', paintApertureMm);

  const eyepieceName = textBox('Eyepiece name');
  const eyepieceFocal = numberBox('Eyepiece focal length (mm)');
  const apparentField = numberBox('Apparent field (°)');

  const barlowName = textBox('Barlow name');
  const barlowFactor = numberBox('Barlow factor');

  const siteName = textBox('Site name');
  const latitude = numberBox('Latitude');
  const longitude = numberBox('Longitude');
  const timeZone = select(
    'Time zone',
    TIME_ZONES.map((zone) => ({ value: zone, label: zone })),
    'UTC',
  );

  const listHolder = el('div', { class: 'kit-list' });
  const paintList = (): void => {
    const { copy } = appState();
    listHolder.replaceChildren(
      kitList(
        copy.kit?.telescopes ?? [],
        copy.kit?.eyepieces ?? [],
        copy.kit?.barlows ?? [],
        copy.sites,
      ),
    );
  };
  const afterAdd = (): void => {
    void prefetchAccount(true).then(paintList);
  };

  const telescopeForm = addForm(
    {
      submitLabel: 'Add telescope',
      accent: true,
      fields: [
        labelledField('Telescope name', telescopeName),
        el('div', { class: 'field-pair' }, [
          labelledField('Aperture', aperture),
          labelledField('Aperture unit', apertureUnit),
        ]),
        apertureMm,
        labelledField('Focal length (mm)', telescopeFocal),
      ],
      controls: [telescopeName, aperture, telescopeFocal],
      firstField: telescopeName,
      path: '/api/kit/telescopes',
      payload: () => ({
        name: telescopeName.value,
        aperture: aperture.value === '' ? null : Number(aperture.value),
        aperture_unit: apertureUnit.value,
        focal_length_mm: telescopeFocal.value === '' ? null : Number(telescopeFocal.value),
      }),
      name: () => telescopeName.value.trim(),
      fieldFor: (key) =>
        key === 'name'
          ? telescopeName
          : key === 'aperture'
            ? aperture
            : key === 'focal_length_mm'
              ? telescopeFocal
              : null,
    },
    () => {
      setStatus(apertureMm, '');
      afterAdd();
    },
  );

  const eyepieceForm = addForm(
    {
      submitLabel: 'Add eyepiece',
      fields: [
        labelledField('Eyepiece name', eyepieceName),
        labelledField('Eyepiece focal length (mm)', eyepieceFocal),
        labelledField('Apparent field (°)', apparentField),
      ],
      controls: [eyepieceName, eyepieceFocal, apparentField],
      firstField: eyepieceName,
      path: '/api/kit/eyepieces',
      payload: () => ({
        name: eyepieceName.value,
        focal_length_mm: eyepieceFocal.value === '' ? null : Number(eyepieceFocal.value),
        apparent_field_deg: apparentField.value === '' ? null : Number(apparentField.value),
      }),
      name: () => eyepieceName.value.trim(),
      fieldFor: (key) =>
        key === 'name'
          ? eyepieceName
          : key === 'focal_length_mm'
            ? eyepieceFocal
            : key === 'apparent_field_deg'
              ? apparentField
              : null,
    },
    afterAdd,
  );

  const barlowForm = addForm(
    {
      submitLabel: 'Add Barlow',
      fields: [
        labelledField('Barlow name', barlowName),
        labelledField('Barlow factor', barlowFactor),
      ],
      controls: [barlowName, barlowFactor],
      firstField: barlowName,
      path: '/api/kit/barlows',
      payload: () => ({
        name: barlowName.value,
        factor: barlowFactor.value === '' ? null : Number(barlowFactor.value),
      }),
      name: () => barlowName.value.trim(),
      fieldFor: (key) => (key === 'name' ? barlowName : key === 'factor' ? barlowFactor : null),
    },
    afterAdd,
  );

  const siteForm = addForm(
    {
      submitLabel: 'Add site',
      fields: [
        labelledField('Site name', siteName),
        el('div', { class: 'field-pair' }, [
          labelledField('Latitude', latitude),
          labelledField('Longitude', longitude),
        ]),
        labelledField('Time zone', timeZone),
      ],
      controls: [siteName, latitude, longitude],
      firstField: siteName,
      path: '/api/sites',
      payload: () => ({
        name: siteName.value,
        latitude: latitude.value === '' ? null : Number(latitude.value),
        longitude: longitude.value === '' ? null : Number(longitude.value),
        time_zone: timeZone.value,
      }),
      name: () => siteName.value.trim(),
      fieldFor: (key) =>
        key === 'name'
          ? siteName
          : key === 'latitude'
            ? latitude
            : key === 'longitude'
              ? longitude
              : key === 'time_zone'
                ? timeZone
                : null,
    },
    afterAdd,
  );

  const device = el('input', {
    class: 'input',
    attrs: {
      type: 'text',
      'aria-label': 'This device',
      autocomplete: 'off',
      value: appState().deviceName || defaultDeviceName(),
    },
  });
  device.addEventListener('change', () => {
    const value = device.value.trim().slice(0, 40) || defaultDeviceName();
    device.value = value;
    void setDeviceName(value);
  });

  content.append(
    status,
    el('h2', { class: 'subheading', text: 'Add a telescope' }),
    telescopeForm,
    el('h2', { class: 'subheading', text: 'Add an eyepiece' }),
    eyepieceForm,
    el('h2', { class: 'subheading', text: 'Add a Barlow' }),
    barlowForm,
    el('h2', { class: 'subheading', text: 'Your kit' }),
    listHolder,
    el('h2', { class: 'subheading', text: 'Add a site' }),
    siteForm,
    labelledField('This device', device),
  );

  paintList();
  void prefetchAccount().then(paintList);
  return root;
}
