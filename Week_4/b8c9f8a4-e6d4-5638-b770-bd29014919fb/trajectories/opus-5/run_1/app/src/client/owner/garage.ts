import { LISTING_WORD } from '../../shared/copy';
import { formatPounds } from '../../shared/format';
import type { CarDto } from '../../shared/types';
import { ApiRefusal, request } from '../shared/api';
import { carFileFooter, statusRegion, unitsBar } from '../shared/chrome';
import { el, focusTarget, onPress, setPending } from '../shared/dom';
import { announce } from '../shared/live';
import { ownerAction, sessionEnded } from './session';
import { signOutButton } from './signout';

interface Field {
  label: string;
  name: keyof NewCar;
  kind: 'text' | 'number' | 'textarea';
  ariaLabel: string;
}

interface NewCar {
  name: string;
  registration: string;
  askingPounds: string;
  viewingArea: string;
  homeAddress: string;
  story: string;
}

const FIELDS: readonly Field[] = [
  { label: 'Car name', name: 'name', kind: 'text', ariaLabel: 'Car name' },
  { label: 'Registration', name: 'registration', kind: 'text', ariaLabel: 'Registration' },
  { label: 'Asking price in pounds', name: 'askingPounds', kind: 'number', ariaLabel: 'Asking price in pounds' },
  { label: 'Viewing area', name: 'viewingArea', kind: 'text', ariaLabel: 'Viewing area' },
  { label: 'Home address', name: 'homeAddress', kind: 'text', ariaLabel: 'Home address' },
  { label: 'Owner story', name: 'story', kind: 'textarea', ariaLabel: 'Owner story' },
];

export const renderGarage = async (root: HTMLElement): Promise<void> => {
  const status = statusRegion('Owner status');
  const list = el('ul', { class: 'garage-list', role: 'list', 'aria-label': 'Garage' });

  const inputs = new Map<keyof NewCar, HTMLInputElement | HTMLTextAreaElement>();
  const errors = new Map<keyof NewCar, HTMLElement>();
  const formFields: Node[] = [];

  for (const field of FIELDS) {
    const id = `new-car-${field.name}`;
    const control =
      field.kind === 'textarea'
        ? (el('textarea', { class: 'text-input', id, rows: 3 }) as HTMLTextAreaElement)
        : (el('input', {
            class: field.kind === 'number' ? 'spin-input figures' : 'text-input',
            type: field.kind === 'number' ? 'number' : 'text',
            id,
            ...(field.kind === 'number' ? { min: '1', max: '10000000', step: '1' } : {}),
          }) as HTMLInputElement);
    control.setAttribute('aria-label', field.ariaLabel);
    const error = el('p', { class: 'field-error' });
    error.hidden = true;
    inputs.set(field.name, control);
    errors.set(field.name, error);
    formFields.push(el('label', { class: 'field-label', for: id, text: field.label }), control, error);
  }

  const create = el('button', { type: 'button', class: 'pill-solid', text: 'Create car file' });

  const paint = (cars: readonly CarDto[]): void => {
    list.replaceChildren(
      ...cars.map((car) =>
        el('li', { class: 'garage-item card' }, [
          el('a', { class: 'garage-link', href: `/owner/cars/${car.id}`, text: car.name }),
          el('p', { class: 'garage-status', text: LISTING_WORD[car.listingStatus] }),
          el('p', {
            class: 'garage-version figures',
            text: car.currentVersion === null ? 'No version yet' : `Version ${car.currentVersion}`,
          }),
          el('p', { class: 'garage-advisories', text: `Open advisories: ${car.workingOpenAdvisories}` }),
          el('p', { class: 'garage-asking figures', text: formatPounds(car.askingPounds) }),
        ]),
      ),
    );
  };

  onPress(create, () => {
    void ownerAction(async () => {
      setPending(create, true);
      for (const error of errors.values()) {
        error.hidden = true;
        error.textContent = '';
      }
      try {
        const body = {
          name: inputs.get('name')?.value ?? '',
          registration: inputs.get('registration')?.value ?? '',
          askingPounds: Number(inputs.get('askingPounds')?.value ?? ''),
          viewingArea: inputs.get('viewingArea')?.value ?? '',
          homeAddress: inputs.get('homeAddress')?.value ?? '',
          story: inputs.get('story')?.value ?? '',
        };
        const car = await request<CarDto>('/api/owner/cars', { method: 'POST', body });
        window.location.assign(`/owner/cars/${car.id}#panels`);
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal && error.body.errors !== undefined) {
          for (const [field, message] of Object.entries(error.body.errors)) {
            const node = errors.get(field as keyof NewCar);
            if (node === undefined) continue;
            node.hidden = false;
            node.textContent = message;
            announce(status, message);
          }
          return;
        }
        throw error;
      } finally {
        setPending(create, false);
      }
    }, create);
  });

  root.replaceChildren(
    unitsBar(),
    el('header', { class: 'owner-header' }, [
      el('span', { class: 'wordmark', text: 'Ostler Lane' }),
      el('h1', { class: 'owner-heading', text: 'Garage' }),
      signOutButton(status),
    ]),
    status,
    el('main', { class: 'garage-main' }, [
      list,
      el('section', { class: 'new-car card' }, [
        el('h2', { class: 'section-heading', text: 'Add a car file' }),
        ...formFields,
        create,
      ]),
    ]),
    carFileFooter(),
  );

  const heading = root.querySelector<HTMLElement>('.owner-heading');
  if (heading !== null) focusTarget(heading);
  const cars = await request<{ cars: CarDto[] }>('/api/owner/cars');
  paint(cars.cars);
};
