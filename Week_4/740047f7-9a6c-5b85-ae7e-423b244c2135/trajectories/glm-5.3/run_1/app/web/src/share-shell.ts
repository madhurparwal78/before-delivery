// The share page's own minimal dialog helper, without importing the console shell.

import { h } from './ui';
import { openDialog } from './dialog';

export function openShortcuts(opener: HTMLElement | null) {
  openDialog({
    title: 'Keyboard shortcuts',
    body: (root) => {
      const rows: [string, string][] = [
        ['Left / Right arrow', 'Orbit the camera 15°'],
        ['Up / Down arrow', 'Tilt the camera 10°'],
        ['+ / -', 'Zoom in / out'],
        ['U', 'Unwrap the pen'],
        ['W', 'Wrap the pen'],
        ['?', 'Open this dialog'],
      ];
      const table = h('table');
      for (const [k, v] of rows) {
        table.append(h('tr', {}, h('td', { text: k }), h('td', { text: v })));
      }
      root.append(table);
    },
  }, opener);
}
