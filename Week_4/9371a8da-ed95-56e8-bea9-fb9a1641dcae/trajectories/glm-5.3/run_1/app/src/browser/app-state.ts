import { parsePath, safeNext, type Route } from './router.js';

export interface App {
  render(): void;
}

let currentApp: { render: () => void } | null = null;

export function setApp(app: { render: () => void }): void {
  currentApp = app;
}

export function rerender(): void {
  currentApp?.render();
}

/** Push a new browser history entry for a same-origin path. */
export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export interface Nav {
  route: Route;
  navigate: typeof navigate;
}

export function currentRoute(): Route {
  return parsePath(location.pathname, location.search);
}

export function nextTarget(route: Route): string | null {
  return route.name === 'signin' ? safeNext(route.next) : null;
}

// Focus management: keep the element that should hold focus across renders.
let focusTarget: { id: string } | null = null;

export function requestFocus(id: string): void {
  focusTarget = { id };
}

export function takeFocusTarget(): { id: string } | null {
  const t = focusTarget;
  focusTarget = null;
  return t;
}

export function moveFocus(el: HTMLElement | null): void {
  if (el) {
    el.focus();
    return;
  }
}

/** Escape closes only the topmost layer; each layer registers its closer. */
const layerStack: { id: string; close: () => void }[] = [];

export function pushLayer(id: string, close: () => void): void {
  layerStack.push({ id, close });
}

export function popLayer(id: string): void {
  const idx = layerStack.findIndex((l) => l.id === id);
  if (idx >= 0) layerStack.splice(idx, 1);
}

export function escapeTopLayer(): boolean {
  const top = layerStack[layerStack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
