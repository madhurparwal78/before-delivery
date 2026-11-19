let available: boolean | undefined;

/** Whether this page can make a WebGL 2 context. Probed once; the probe context is released at once. */
export function hasWebGL(): boolean {
  if (available !== undefined) return available;
  const gl = document.createElement("canvas").getContext("webgl2");
  available = gl !== null;
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return available;
}
