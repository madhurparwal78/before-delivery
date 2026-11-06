export type Screen = {
  mount: (stage: HTMLElement, panelHost: HTMLElement) => void;
  update: () => void;
  dispose: () => void;
};
