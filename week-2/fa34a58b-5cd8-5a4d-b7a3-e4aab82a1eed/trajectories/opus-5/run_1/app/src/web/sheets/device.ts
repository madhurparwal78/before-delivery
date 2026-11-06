import { api, ApiFailure, HubUnreachable, HUB_UNREACHABLE_COPY } from '../api';
import { el, focusFirstIn, must, openSheet, svgIcon } from '../dom';
import { hhmmss } from '../format';
import type { Device, LightState, PlugState, ThermostatState } from '../../shared/types';

/** The open device sheet's repaint, so socket updates reach it while it is open. */
const openSheets = new Map<string, (device: Device) => void>();

export function notifyDeviceSheets(device: Device): void {
  openSheets.get(device.id)?.(device);
}

/**
 * One request at a time per device, so changes reach the server in the order chosen
 * and only the newest answer is acted on.
 */
const queues = new Map<string, Promise<void>>();
const tokens = new Map<string, number>();

export function sendDeviceState(
  device: Device,
  patch: Record<string, unknown>,
  onRefusal: (message: string) => void,
): Promise<void> {
  const token = (tokens.get(device.id) ?? 0) + 1;
  tokens.set(device.id, token);
  const next = (queues.get(device.id) ?? Promise.resolve()).then(async () => {
    try {
      await api.put<{ device: Device }>(`/api/devices/${device.id}/state`, patch);
    } catch (error) {
      if (tokens.get(device.id) !== token) return;
      if (error instanceof HubUnreachable) onRefusal(HUB_UNREACHABLE_COPY);
      else if (error instanceof ApiFailure) onRefusal(error.message);
      else throw error;
    }
  });
  queues.set(device.id, next);
  return next;
}

export function openDeviceSheet(
  device: Device,
  opener: HTMLElement,
  latest: (deviceId: string) => Device | undefined,
): void {
  const sheet = openSheet({ name: device.name, opener, className: 'device-sheet' });
  if (sheet.body.childElementCount > 0) {
    focusFirstIn(sheet);
    return;
  }

  const statusLine = el('p', { class: 'device-status' });
  const reportLine = el('p', { class: 'device-report num' });
  const alertSlot = el('div', { class: 'alert-slot' });
  const controls = el('div', { class: 'sheet-controls' });

  const showRefusal = (message: string): void => {
    alertSlot.replaceChildren(el('p', { class: 'alert', role: 'alert' }, [message]));
  };

  sheet.body.replaceChildren(
    el('h2', { class: 'sheet-heading' }, [device.name]),
    statusLine,
    reportLine,
    alertSlot,
    controls,
    el('button', { type: 'button', class: 'control sheet-close', 'data-close': '' }, [
      svgIcon('x'),
      el('span', {}, ['Close']),
    ]),
  );
  must<HTMLButtonElement>('[data-close]', sheet.body).addEventListener('click', () => {
    openSheets.delete(device.id);
    sheet.close();
  });

  let powerButton: HTMLButtonElement | null = null;
  let brightness: HTMLInputElement | null = null;
  let setpoint: HTMLInputElement | null = null;

  if (device.kind === 'light' || device.kind === 'plug') {
    powerButton = el('button', {
      type: 'button',
      class: 'control switch',
      role: 'switch',
      'aria-label': 'Power',
      'aria-checked': 'false',
    }) as HTMLButtonElement;
    powerButton.append(el('span', { class: 'switch-track' }), el('span', {}, ['Power']));
    powerButton.addEventListener('click', () => {
      const current = latest(device.id) ?? device;
      const next = !(current.state as PlugState).on;
      powerButton?.setAttribute('aria-checked', String(next));
      void sendDeviceState(device, { on: next }, showRefusal);
    });
    controls.append(powerButton);
  }

  if (device.kind === 'light') {
    brightness = el('input', {
      type: 'range',
      class: 'control range',
      id: `brightness-${device.id}`,
      'aria-label': 'Brightness',
      min: '1',
      max: '100',
      step: '1',
    }) as HTMLInputElement;
    brightness.addEventListener('change', () => {
      void sendDeviceState(device, { brightness: Number(brightness?.value ?? 1) }, showRefusal);
    });
    controls.append(
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', for: `brightness-${device.id}` }, ['Brightness']),
        brightness,
      ]),
    );
  }

  if (device.kind === 'thermostat') {
    setpoint = el('input', {
      type: 'number',
      class: 'control input num',
      id: `setpoint-${device.id}`,
      'aria-label': 'Setpoint',
      min: '60',
      max: '80',
      step: '1',
    }) as HTMLInputElement;
    setpoint.addEventListener('change', () => {
      void sendDeviceState(device, { setpoint_f: Number(setpoint?.value ?? 60) }, showRefusal);
    });
    controls.append(
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', for: `setpoint-${device.id}` }, ['Setpoint']),
        setpoint,
      ]),
    );
  }

  const paint = (next: Device): void => {
    statusLine.textContent = next.online ? 'Online' : 'Offline';
    reportLine.textContent = `Last report ${hhmmss(next.updated_at)}`;
    if (powerButton) powerButton.setAttribute('aria-checked', String((next.state as PlugState).on));
    if (brightness) brightness.value = String((next.state as LightState).brightness);
    if (setpoint) setpoint.value = String((next.state as ThermostatState).setpoint_f);
  };

  paint(latest(device.id) ?? device);
  openSheets.set(device.id, paint);
  focusFirstIn(sheet);
}
