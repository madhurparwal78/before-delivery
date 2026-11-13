import { getApp } from '../app.js';

export interface RouteContext {
  path: string;
  params: URLSearchParams;
}

type Screen = (ctx: RouteContext) => Promise<void>;

const routes: Array<{ pattern: RegExp; screen: Screen }> = [];

export function registerRoute(pattern: RegExp, screen: Screen): void {
  routes.push({ pattern, screen });
}

export async function renderRoute(path: string, params: URLSearchParams): Promise<void> {
  const app = getApp();
  for (const { pattern, screen } of routes) {
    const match = pattern.exec(path);
    if (match) {
      await screen({ path, params });
      return;
    }
  }
  app.main.textContent = '';
  const heading = document.createElement('h1');
  heading.textContent = 'Page not found';
  app.main.append(heading);
}
