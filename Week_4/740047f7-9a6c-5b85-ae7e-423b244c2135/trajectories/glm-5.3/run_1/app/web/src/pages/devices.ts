// The Devices page: presence and the browser's device identity.

import { api, deviceId, deviceName, DEVICES } from '../api';
import { h, clear } from '../ui';
import { buildShell } from '../main';
import * as T from '../types';

export class DevicesPage {
  private root: HTMLElement;
  private host!: HTMLElement;
  private timer = 0;

  constructor(app: HTMLElement) {
    const { main } = buildShell(app, '/devices');
    this.root = main;
    this.build();
    this.load();
    this.timer = window.setInterval(() => this.load(), 5000);
  }

  teardown() { clearInterval(this.timer); }

  private build() {
    this.root.append(h('div', { class: 'gutters', style: 'padding-top:24px' },
      h('h1', { class: 'display-l', text: 'Devices' }),
      h('div', { class: 'muted', style: 'margin-top:8px', text: `This browser is ${deviceName()}` }),
    ));
    this.host = h('div', { class: 'gutters', style: 'margin-top:16px' });
    this.root.append(this.host);
  }

  private async load() {
    try {
      const res = await api.get<{ devices: T.Device[] }>('/api/devices');
      clear(this.host);
      for (const d of res.devices) {
        const row = h('div', { class: 'farm-row' },
          h('span', { class: 'num', text: `${d.name} — ${d.online ? 'Online' : 'Offline'}` }),
          h('button', {
            class: 'btn', text: `Use this browser as ${d.name}`,
            onclick: () => {
              try { localStorage.setItem('pensight-device', d.id); } catch {}
              location.reload();
            },
          }),
        );
        this.host.append(row);
      }
    } catch {}
  }
}
