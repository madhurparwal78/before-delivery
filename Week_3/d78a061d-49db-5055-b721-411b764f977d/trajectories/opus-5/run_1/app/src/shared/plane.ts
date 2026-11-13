import { DRAWING_PLANE_CSS_PX, PLANE_HALF_METRES } from './constants.js';

/**
 * The single place the drawing plane's CSS pixels become metres from its centre.
 * Positions are measured from the plane element's top-left corner, y grows upward.
 */
export function planePixelsToMetres(cssX: number, cssY: number): { x: number; y: number } {
  const span = PLANE_HALF_METRES * 2;
  return {
    x: (cssX / DRAWING_PLANE_CSS_PX) * span - PLANE_HALF_METRES,
    y: PLANE_HALF_METRES - (cssY / DRAWING_PLANE_CSS_PX) * span,
  };
}

export function planeMetresToPixels(x: number, y: number): { cssX: number; cssY: number } {
  const span = PLANE_HALF_METRES * 2;
  return {
    cssX: ((x + PLANE_HALF_METRES) / span) * DRAWING_PLANE_CSS_PX,
    cssY: ((PLANE_HALF_METRES - y) / span) * DRAWING_PLANE_CSS_PX,
  };
}

export function isInsidePlane(x: number, y: number): boolean {
  return (
    x >= -PLANE_HALF_METRES &&
    x <= PLANE_HALF_METRES &&
    y >= -PLANE_HALF_METRES &&
    y <= PLANE_HALF_METRES
  );
}
