export interface Quality {
  webgl: boolean;
  /** A CPU renderer (SwiftShader, llvmpipe): fewer instances, pixel ratio 1, a smaller drawing buffer. */
  software: boolean;
  reduced: boolean;
  /** Device pixel ratio the renderer uses. */
  pixelRatio: number;
  /** Fraction of the viewport the drawing buffer is rendered at, before CSS scales it up. */
  renderScale: number;
  /** Multiplier for instance and particle counts. */
  density: number;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

function probe(): { webgl: boolean; software: boolean } {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { webgl: false, software: false };
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return { webgl: true, software: SOFTWARE.test(renderer) };
  } catch {
    return { webgl: false, software: false };
  }
}

export function detectQuality(): Quality {
  const { webgl, software } = probe();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = window.innerWidth < 768;
  return {
    webgl,
    software,
    reduced,
    pixelRatio: software ? 1 : Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2),
    renderScale: software ? 0.6 : 1,
    density: software ? 0.35 : small ? 0.6 : 1,
  };
}
