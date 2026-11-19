/** The sales coordinator's console: floor bands, the unit editor and active holds. */

import { get, post, put } from '../api';
import { Header } from '../chrome';
import { announce, closeLayer, el, noticesNode, openLayer } from '../dom';
import { money, salesTime } from '../display';
import { currentAccount, loadSession, openSignInDialog } from '../session';
import { FLOOR_BANDS } from '../../shared/units';
import type {
  ConsoleHoldRow,
  ConsoleUnitRow,
  Hold,
  PriceVersionRow,
} from '../../shared/types';
import type { Page } from '../router';

export function createConsolePage(): Page {
  const header = new Header();
  const bandsRegion = el('section', { class: 'console-field', role: 'region', 'aria-label': 'Floor bands' });
  const unitRegion = el('section', { class: 'console-field' });
  const holdsRegion = el('section', { class: 'console-field' });
  const unitSearch = el('input', {
    class: 'input',
    type: 'search',
    id: 'console-unit-code',
    'aria-label': 'Unit code',
    autocomplete: 'off',
  }) as HTMLInputElement;
  const main = el('main', { class: 'console' }, [
    el('h1', { text: 'Sales console' }),
    bandsRegion,
    el('div', { class: 'field' }, [el('label', { for: 'console-unit-code', text: 'Unit code' }), unitSearch]),
    unitRegion,
    holdsRegion,
  ]);
  const node = el('div', { class: 'page page-console' }, [header.node, main, noticesNode()]);

  let units: ConsoleUnitRow[] = [];

  const paintRefusal = (): void => {
    main.replaceChildren(
      el('h1', { text: "Your account can't do that." }),
      el('a', { class: 'action action-quiet', href: '/finder', text: 'Open the finder' }),
    );
  };

  async function loadUnits(): Promise<boolean> {
    const result = await get<{ units: ConsoleUnitRow[] }>('/api/console/units');
    if (result.status === 403) {
      paintRefusal();
      return false;
    }
    if (result.status === 401) {
      openSignInDialog({
        onSignedIn: () => void start(),
      });
      return false;
    }
    if (!result.ok || !result.data) return false;
    units = result.data.units;
    return true;
  }

  function paintBands(): void {
    const released = new Set(units.filter((unit) => unit.status !== 'unreleased').map((unit) => unit.band));
    bandsRegion.replaceChildren(
      el('h2', { text: 'Floor bands' }),
      ...FLOOR_BANDS.filter((band) => !released.has(band.id)).map((band) =>
        el('button', {
          type: 'button',
          class: 'action action-dark',
          text: `Release floors ${band.id}`,
          onclick: (event) => void releaseBand(band.id, event.currentTarget as HTMLButtonElement),
        }),
      ),
    );
  }

  async function releaseBand(band: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const label = button.textContent ?? '';
    button.textContent = 'Releasing...';
    const result = await post<{ band: string; releasedUnits: number }>(`/api/console/bands/${band}/release`, { body: {} });
    button.textContent = label;
    button.disabled = false;
    if (result.ok) {
      announce(`Floors ${band} released.`);
      await refresh();
      return;
    }
    if (result.error) announce(result.error.message);
  }

  async function paintUnit(code: string): Promise<void> {
    const unit = units.find((candidate) => candidate.code === code.toUpperCase());
    if (!unit) {
      unitRegion.replaceChildren();
      unitRegion.removeAttribute('role');
      unitRegion.removeAttribute('aria-label');
      return;
    }
    unitRegion.setAttribute('role', 'region');
    unitRegion.setAttribute('aria-label', `Unit ${unit.code}`);
    const message = el('p', { class: 'console-message' });
    const price = el('input', {
      class: 'input',
      type: 'number',
      step: '1',
      min: '0',
      id: 'console-price',
      'aria-label': 'Price',
      value: String(unit.price),
    }) as HTMLInputElement;
    price.addEventListener('input', () => {
      price.value = price.value.replace(/[^0-9]/g, '');
    });
    const save = el('button', { type: 'button', class: 'action action-dark', text: 'Save price' }) as HTMLButtonElement;
    const photoInput = el('input', {
      type: 'file',
      id: 'console-photo',
      accept: 'image/png,image/jpeg',
      'aria-label': 'View photograph',
    }) as HTMLInputElement;
    const upload = el('button', { type: 'button', class: 'action action-dark', text: 'Upload photo' }) as HTMLButtonElement;
    const withdraw = el('button', { type: 'button', class: 'action action-dark', text: 'Withdraw unit' }) as HTMLButtonElement;

    save.addEventListener('click', () => void savePrice(unit, price, save, message));
    upload.addEventListener('click', () => void uploadPhoto(unit, photoInput, upload, message));
    withdraw.addEventListener('click', () => askWithdraw(unit, withdraw, message));

    const versions = await get<{ versions: PriceVersionRow[] }>(`/api/console/units/${unit.code}/prices`);
    unitRegion.replaceChildren(
      el('h2', { text: `Unit ${unit.code}` }),
      el('p', { class: 'tabular', text: `$${money(unit.price)} · version ${unit.priceVersion} · ${unit.status}` }),
      el('p', { text: unit.viewPhotographed ? 'View photographed' : 'No view photograph yet' }),
      message,
      el('div', { class: 'field' }, [el('label', { for: 'console-price', text: 'Price' }), price]),
      save,
      el('div', { class: 'field' }, [el('label', { for: 'console-photo', text: 'View photograph' }), photoInput]),
      upload,
      withdraw,
      priceTable(versions.ok && versions.data ? versions.data.versions : []),
    );
  }

  function priceTable(versions: PriceVersionRow[]): HTMLElement {
    return el('table', { class: 'console-table', 'aria-label': 'Price versions' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Version' }),
          el('th', { scope: 'col', text: 'Price' }),
          el('th', { scope: 'col', text: 'Set by' }),
          el('th', { scope: 'col', text: 'Set at' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        versions.map((version) =>
          el('tr', {}, [
            el('td', { class: 'tabular', text: String(version.version) }),
            el('td', { class: 'tabular', text: `$${money(version.price)}` }),
            el('td', { text: version.setBy }),
            el('td', { class: 'tabular', text: salesTime(version.setAt) }),
          ]),
        ),
      ),
    ]);
  }

  async function savePrice(
    unit: ConsoleUnitRow,
    price: HTMLInputElement,
    save: HTMLButtonElement,
    message: HTMLElement,
  ): Promise<void> {
    save.disabled = true;
    save.textContent = 'Saving...';
    const result = await put<{ code: string }>(`/api/console/units/${unit.code}/price`, {
      body: { price: Number(price.value), expectedVersion: unit.priceVersion },
    });
    save.disabled = false;
    save.textContent = 'Save price';
    if (result.ok) {
      announce(`Price saved for ${unit.code}.`);
      await refresh();
      await paintUnit(unit.code);
      return;
    }
    if (result.error) message.textContent = result.error.message;
  }

  async function uploadPhoto(
    unit: ConsoleUnitRow,
    input: HTMLInputElement,
    upload: HTMLButtonElement,
    message: HTMLElement,
  ): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    upload.disabled = true;
    upload.textContent = 'Uploading...';
    const result = await put<{ code: string }>(`/api/console/units/${unit.code}/view-photo`, {
      raw: await file.arrayBuffer(),
      headers: { 'Content-Type': file.type },
    });
    upload.disabled = false;
    upload.textContent = 'Upload photo';
    if (result.ok) {
      announce(`Photo confirmed for ${unit.code}.`);
      await refresh();
      await paintUnit(unit.code);
      return;
    }
    if (result.error) message.textContent = result.error.message;
  }

  function askWithdraw(unit: ConsoleUnitRow, opener: HTMLButtonElement, message: HTMLElement): void {
    const confirm = el('button', { type: 'button', class: 'action action-dark', text: 'Withdraw' }) as HTMLButtonElement;
    const cancel = el('button', {
      type: 'button',
      class: 'action action-quiet',
      text: 'Cancel',
      onclick: () => closeLayer(layer),
    });
    const panel = el('div', {
      class: 'dialog',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-label': `Withdraw ${unit.code}?`,
    }, [el('h2', { text: `Withdraw ${unit.code}?` }), confirm, cancel]);
    const layer = el('div', { class: 'dialog-layer' }, [panel]);
    document.getElementById('app')?.append(layer);
    confirm.addEventListener('click', () => {
      confirm.disabled = true;
      confirm.textContent = 'Withdrawing...';
      void post(`/api/console/units/${unit.code}/withdraw`, { body: {} }).then(async (result) => {
        closeLayer(layer);
        if (result.ok) {
          announce(`${unit.code} withdrawn.`);
          await refresh();
          await paintUnit(unit.code);
          return;
        }
        if (result.error) message.textContent = result.error.message;
      });
    });
    openLayer({ node: layer, returnFocus: opener });
  }

  async function paintHolds(): Promise<void> {
    const result = await get<{ holds: ConsoleHoldRow[] }>('/api/console/holds');
    if (!result.ok || !result.data) return;
    holdsRegion.replaceChildren(
      el('h2', { text: 'Active holds' }),
      el('table', { class: 'console-table', 'aria-label': 'Active holds' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Unit' }),
            el('th', { scope: 'col', text: 'Buyer email' }),
            el('th', { scope: 'col', text: 'Quoted price' }),
            el('th', { scope: 'col', text: 'Ends' }),
            el('th', { scope: 'col', text: 'Convert' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          result.data.holds.map((hold) =>
            el('tr', {}, [
              el('td', { text: hold.unitCode }),
              el('td', { text: hold.buyerEmail }),
              el('td', { class: 'tabular', text: `$${money(hold.quotedPrice)}` }),
              el('td', { class: 'tabular', text: salesTime(hold.endsAt) }),
              el('td', {}, [
                el('button', {
                  type: 'button',
                  class: 'action action-dark',
                  text: `Convert ${hold.unitCode}`,
                  onclick: (event) => void convert(hold, event.currentTarget as HTMLButtonElement),
                }),
              ]),
            ]),
          ),
        ),
      ]),
    );
  }

  async function convert(hold: ConsoleHoldRow, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    button.textContent = 'Converting...';
    const result = await post<{ hold: Hold }>(`/api/console/holds/${hold.id}/convert`, { body: {} });
    if (result.ok) {
      announce('Hold converted to a reservation.');
      await refresh();
      return;
    }
    button.disabled = false;
    button.textContent = `Convert ${hold.unitCode}`;
    if (result.error) announce(result.error.message);
  }

  async function refresh(): Promise<void> {
    if (!(await loadUnits())) return;
    paintBands();
    await paintHolds();
  }

  async function start(): Promise<void> {
    await loadSession();
    const account = currentAccount();
    if (!account) {
      openSignInDialog({ onSignedIn: () => void start() });
      return;
    }
    if (account.role !== 'coordinator') {
      paintRefusal();
      return;
    }
    await refresh();
  }

  unitSearch.addEventListener('change', () => void paintUnit(unitSearch.value.trim()));
  unitSearch.addEventListener('input', () => {
    const code = unitSearch.value.trim().toUpperCase();
    if (/^[0-9]{1,2}[A-H]$/.test(code)) void paintUnit(code);
  });

  void start();

  return { node };
}
