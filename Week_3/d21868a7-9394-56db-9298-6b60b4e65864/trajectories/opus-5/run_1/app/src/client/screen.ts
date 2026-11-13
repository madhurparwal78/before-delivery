/** Every screen is one element, with an optional live refresh and teardown. */
export interface Screen {
  element: HTMLElement;
  refresh?: () => Promise<void>;
  destroy?: () => void;
}
