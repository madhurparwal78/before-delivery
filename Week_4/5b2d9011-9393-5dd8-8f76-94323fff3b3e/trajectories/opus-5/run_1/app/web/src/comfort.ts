// Comfort and controls. The pre-match choice and the player's settings decide
// whether effects are reduced; the system's reduced-motion setting always does.

import { api, Settings } from './api';

const noticeKey = 'holdfast.notice-choice';

const defaults: Settings = {
  bindings: {
    move_up: 'KeyW',
    move_down: 'KeyS',
    move_left: 'KeyA',
    move_right: 'KeyD',
    aim_left: 'KeyQ',
    aim_right: 'KeyE',
    fire: 'Space',
    reload: 'KeyR',
    grenade: 'KeyG',
    revive: 'KeyF',
    shop: 'KeyB',
    timers: 'KeyT',
  },
  master_volume: 70,
  effects_volume: 70,
  reduce_effects: false,
  screen_shake: true,
  camera_bob: true,
};

/** actionLabels names each remappable action as the Controls section prints it. */
export const actionLabels: Record<string, string> = {
  move_up: 'Move up',
  move_down: 'Move down',
  move_left: 'Move left',
  move_right: 'Move right',
  aim_left: 'Aim left',
  aim_right: 'Aim right',
  fire: 'Fire',
  reload: 'Reload',
  grenade: 'Grenade',
  revive: 'Revive',
  shop: 'Shop',
  timers: 'Timers',
};

export const actionOrder = Object.keys(actionLabels);

/** keyLabel renders a keyboard code as its visible label: letters and digits
 *  bare, and every other code spaced wherever a lower-case letter is followed by
 *  an upper-case letter or a digit. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

type Listener = () => void;

/** Comfort owns the settings the browser applies locally. */
class Comfort {
  private settings: Settings = { ...defaults, bindings: { ...defaults.bindings } };
  private signedIn = false;
  private listeners: Listener[] = [];
  private systemReduced = false;

  constructor() {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.systemReduced = query.matches;
    query.addEventListener('change', (ev) => {
      this.systemReduced = ev.matches;
      this.apply();
    });
    if (this.noticeChoice() === 'calm') this.settings.reduce_effects = true;
    this.apply();
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** reduced reports whether every loop, shake, bob and numeral motion is off. */
  reduced(): boolean {
    return this.systemReduced || this.settings.reduce_effects;
  }

  /** systemAsksReduced reports the system's reduced-motion setting, which locks
   *  the shake and bob switches off. */
  systemAsksReduced(): boolean {
    return this.systemReduced;
  }

  shake(): boolean {
    return !this.reduced() && this.settings.screen_shake;
  }

  bob(): boolean {
    return !this.reduced() && this.settings.camera_bob;
  }

  current(): Settings {
    return { ...this.settings, bindings: { ...this.settings.bindings } };
  }

  bindingFor(action: string): string {
    return this.settings.bindings[action] ?? defaults.bindings[action];
  }

  /** actionForCode reports which action a keyboard code is bound to. */
  actionForCode(code: string): string | null {
    for (const [action, bound] of Object.entries(this.settings.bindings)) {
      if (bound === code) return action;
    }
    return null;
  }

  noticeChoice(): string | null {
    try {
      return window.localStorage.getItem(noticeKey);
    } catch {
      return null;
    }
  }

  storeNoticeChoice(choice: 'standard' | 'calm'): void {
    try {
      window.localStorage.setItem(noticeKey, choice);
    } catch {
      // A browser that refuses storage simply shows the panel again.
    }
  }

  /** adopt takes the player's stored settings once they sign in. */
  adopt(settings: Settings): void {
    this.settings = { ...settings, bindings: { ...settings.bindings } };
    this.signedIn = true;
    if (this.noticeChoice() === 'calm' && !this.settings.reduce_effects) {
      this.settings.reduce_effects = true;
      void this.persist();
    }
    this.apply();
  }

  forget(): void {
    this.signedIn = false;
  }

  /** set changes settings and stores them for a signed-in player. */
  async set(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    if (patch.bindings) this.settings.bindings = { ...patch.bindings };
    this.apply();
    await this.persist();
  }

  resetBindings(): Promise<void> {
    return this.set({ bindings: { ...defaults.bindings } });
  }

  private async persist(): Promise<void> {
    if (!this.signedIn) return;
    try {
      await api.saveSettings(this.current());
    } catch {
      // The notices line reports the failure; the local choice still holds.
    }
  }

  private apply(): void {
    document.body.classList.toggle('reduced', this.reduced());
    this.emit();
  }
}

export const comfort = new Comfort();
