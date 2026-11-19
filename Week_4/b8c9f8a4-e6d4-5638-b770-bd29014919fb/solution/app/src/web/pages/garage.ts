// The garage: the owner's car files, and the form that starts a new one.

import { api, Refused } from '../api.js';
import { el, on } from '../dom.js';
import { LISTING_WORD } from '../../shared/copy.js';
import { money } from '../format.js';
import { carFileFooter } from '../parts/footer.js';
import { ownerChrome } from '../parts/owner-chrome.js';
import { announce } from '../ui/status.js';
import { pressable } from '../ui/pending.js';
import { entrance } from '../ui/entrance.js';
import type { CarView } from '../types.js';

const FIELDS: { name: string; label: string; kind: 'text' | 'number' }[] = [
  { name: 'name', label: 'Car name', kind: 'text' },
  { name: 'registration', label: 'Registration', kind: 'text' },
  { name: 'askingPounds', label: 'Asking price in pounds', kind: 'number' },
  { name: 'viewingArea', label: 'Viewing area', kind: 'text' },
  { name: 'homeAddress', label: 'Home address', kind: 'text' },
  { name: 'story', label: 'Owner story', kind: 'text' },
];

export function garagePage(root: HTMLElement, cars: CarView[]): void {
  const chrome = ownerChrome('Your car files');
  const inputs = new Map<string, HTMLInputElement>();
  const errors = new Map<string, HTMLElement>();

  const form = el('div', { class: 'card new-car' }, [
    entrance(el('h2', {}, ['Start a new car file'])),
    ...FIELDS.map((field) => {
      const input = el('input', {
        type: field.kind === 'number' ? 'number' : 'text',
        'aria-label': field.label,
        class: `field-input${field.kind === 'number' ? ' figures' : ''}`,
        ...(field.kind === 'number' ? { min: '1', max: '10000000', step: '1' } : {}),
      });
      const error = el('p', { class: 'field-error', hidden: true });
      inputs.set(field.name, input);
      errors.set(field.name, error);
      return el('label', { class: 'field' }, [el('span', {}, [field.label]), input, error]);
    }),
  ]);

  const create = el('button', { type: 'button', class: 'pill pill-solid' }, ['Create car file']);
  pressable(create, async () => {
    for (const error of errors.values()) {
      error.hidden = true;
      error.textContent = '';
    }
    announce(chrome.status, 'Creating car file');
    const body: Record<string, unknown> = {};
    for (const field of FIELDS) {
      const value = inputs.get(field.name)?.value ?? '';
      body[field.name] = field.kind === 'number' ? Number(value) : value;
    }
    try {
      const car = await api.post<CarView>('/api/owner/cars', body);
      window.location.assign(`/owner/cars/${car.id}#panels`);
    } catch (bad) {
      if (bad instanceof Refused && bad.body.errors) {
        for (const [field, message] of Object.entries(bad.body.errors)) {
          const error = errors.get(field);
          if (error) {
            error.hidden = false;
            error.textContent = message;
          }
        }
        announce(chrome.status, 'Check the car file details');
        return;
      }
      announce(chrome.status, 'That could not be sent. Try again.');
    }
  });
  form.append(create);

  const list = el('ul', { role: 'list', 'aria-label': 'Garage', class: 'garage-list' },
    cars.map((car) => entrance(el('li', { class: 'card garage-row' }, [
      el('a', { href: `/owner/cars/${car.id}`, class: 'garage-link' }, [car.name]),
      el('p', { class: 'garage-meta' }, [
        `${LISTING_WORD[car.listingStatus]} · ${car.currentVersion === null ? 'No version yet' : `Version ${car.currentVersion}`}`,
      ]),
      el('p', { class: 'garage-meta figures' }, [
        `${money(car.askingPounds)} · Open advisories: ${car.workingOpenAdvisories}`,
      ]),
    ]))));

  root.replaceChildren(el('div', { class: 'owner-page garage-page' }, [
    chrome.bar,
    chrome.header,
    chrome.notice,
    el('main', { id: 'main', class: 'garage-main' }, [
      entrance(el('h1', {}, ['Your garage'])),
      list,
      form,
      chrome.status,
    ]),
    carFileFooter(),
  ]));

  for (const link of list.querySelectorAll('a')) {
    on(link, 'click', (event) => {
      event.preventDefault();
      window.location.assign((link as HTMLAnchorElement).getAttribute('href') ?? '/owner/cars');
    });
  }
}
