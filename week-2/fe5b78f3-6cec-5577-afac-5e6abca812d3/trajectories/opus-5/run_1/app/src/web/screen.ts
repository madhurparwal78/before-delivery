import type { AppState } from './app-state';
import type { RibbonStop } from './components';

export interface Router {
  go(path: string, replace?: boolean): void;
  readonly state: AppState;
  refreshNav(): void;
}

export interface Screen {
  readonly ribbon: readonly RibbonStop[];
  readonly cleanup?: () => void;
}

export interface ScreenContext {
  readonly router: Router;
  readonly state: AppState;
  readonly main: HTMLElement;
  readonly url: URL;
  readonly setRibbon: (stops: readonly RibbonStop[]) => void;
}
