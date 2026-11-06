import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles.css';
import { hydrate, options } from 'preact';
import { App } from './app.js';
import type { PageData } from './data.js';

// Effects run straight after each render instead of waiting for an animation frame, so the page never stalls on a
// frame timer (a background tab, a frozen clock) before it loads its data.
options.requestAnimationFrame = (callback) => queueMicrotask(callback);

const holder = document.getElementById('page-data');
const data: PageData = holder?.textContent ? JSON.parse(holder.textContent) : {};
hydrate(<App data={data} />, document.getElementById('app')!);
