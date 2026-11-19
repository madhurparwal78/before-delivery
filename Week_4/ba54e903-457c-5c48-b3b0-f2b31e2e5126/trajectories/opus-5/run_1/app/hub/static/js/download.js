// The download page names the platform this browser is on.

import { element } from './api.js';

const PLATFORMS = [
  ['Android', /Android/i],
  ['iOS', /iPhone|iPad|iPod/i],
  ['macOS', /Macintosh|Mac OS X/i],
  ['Windows', /Windows/i],
  ['Linux', /Linux|X11/i],
];

const agent = navigator.userAgent;
const found = PLATFORMS.find(([, pattern]) => pattern.test(agent));
const platform = found ? found[0] : 'Windows';

document.getElementById('download-primary').textContent = 'Download for ' + platform;
document.getElementById('other-platforms').replaceChildren(
  ...PLATFORMS.filter(([name]) => name !== platform)
    .map(([name]) => element('li', { text: 'Download for ' + name }))
);
