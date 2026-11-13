export interface NavigateOptions {
  replace?: boolean;
}

type NavigateFn = (path: string, options?: NavigateOptions) => void;

let current: NavigateFn = () => undefined;

export function setNavigator(fn: NavigateFn): void {
  current = fn;
}

export function navigate(path: string, options?: NavigateOptions): void {
  current(path, options);
}

export interface Screen {
  element: HTMLElement;
  topics?: string[];
  update?: () => void;
  destroy?: () => void;
}

export interface ScreenContext {
  params: Record<string, string>;
  url: URL;
}

export type ScreenBuilder = (context: ScreenContext) => Screen;
