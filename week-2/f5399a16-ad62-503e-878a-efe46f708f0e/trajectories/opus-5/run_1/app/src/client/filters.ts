import { state } from './app.js';
import type { ScreenName } from '../domain/screens.js';
import type { Child } from './dom.js';
import { registerSurface } from './shell.js';
import { surfaceView } from './ui.js';

const builders = new Map<ScreenName, () => Child>();

/** Filters is one sheet whose body comes from the screen showing it. */
export function setFilterBody(name: ScreenName, body: () => Child): void {
  builders.set(name, body);
}

registerSurface('Filters', (surface) =>
  surfaceView(surface, {
    title: 'Filters',
    body: [builders.get(state.screen.name)?.() ?? null],
  }),
);
