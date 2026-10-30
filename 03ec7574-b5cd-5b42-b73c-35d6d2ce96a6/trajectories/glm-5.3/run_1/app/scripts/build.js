import { mkdirSync } from 'node:fs';
// The app serves server-rendered HTML and prebuilt assets directly; the build
// step only makes sure the shipped asset directories exist.
mkdirSync('pages/assets', { recursive: true });
console.log('corvo build complete');
