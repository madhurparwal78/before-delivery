// Whether the browser offers WebGL; checked before the globe module (and Cesium) is loaded.
export function webglAvailable(): boolean {
  const probe = document.createElement("canvas");
  return (probe.getContext("webgl2") ?? probe.getContext("webgl")) !== null;
}
