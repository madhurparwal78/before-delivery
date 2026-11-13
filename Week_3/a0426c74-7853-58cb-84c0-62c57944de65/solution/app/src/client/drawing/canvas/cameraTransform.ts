import type { View } from '../../../shared/geometry/index.ts';

/** The camera as a CSS `transform` (CSS wants commas in `matrix()`). */
export const cameraTransform = (view: View): string => `matrix(${view.zoom}, 0, 0, ${-view.zoom}, ${view.panX}, ${view.panY})`;
