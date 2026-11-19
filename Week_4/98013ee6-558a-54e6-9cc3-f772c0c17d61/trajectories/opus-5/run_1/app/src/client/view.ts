export interface View {
  dispose?(): void;
}

export interface RouteContext {
  main: HTMLElement;
  url: URL;
  params: Record<string, string>;
}
