/** Motion durations in seconds. The stylesheet carries the matching CSS values. */

export const CHASE_SECONDS = 0.33;
export const FLY_SECONDS = 1.1;

export function webGlSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ??
        canvas.getContext("webgl") ??
        canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}
